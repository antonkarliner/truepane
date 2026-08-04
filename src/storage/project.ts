// The single seam between the app and persistent storage.
//
// Project binaries (screenshots, custom fonts) live in IndexedDB as blobs,
// keyed by content hash; the document that references them is small JSON. That
// replaces a single localStorage key holding megabytes of base64, which had a
// hard ~5MB ceiling and failed silently.
//
// Nothing here may be imported by src/core/* — core is shared verbatim with the
// Node MCP server, which has no IndexedDB. The exported project format is also
// untouched: a .truepane file still embeds data URLs, via serializeMedia /
// normalizeAppState, so it stays portable.
import { normalizeBrandKit, type BrandKit } from "../core/brand-kit";
import { STORAGE_KEY } from "../core/constants";
import { serializeMedia } from "../core/media";
import { normalizeAppState, serializeTranslations } from "../core/normalize";
import type { AppState } from "../core/types";
import {
  assetId,
  blobToDataUrl,
  dataUrlToBlob,
  deleteAssets,
  getAsset,
  getDocument,
  listAssetIds,
  openDb,
  putAsset,
  putDocument,
} from "./assets";
import {
  externalizeAssets,
  internalizeAssets,
  referencedAssetIds,
  type StoredDocument,
} from "./document";

const PROJECT_KEY = "project";
const BRAND_KITS_KEY = "brand-kits";
const MIGRATION_KEY = "migration";

// Mirrors src/core/brand-kit.ts BRAND_KIT_STORAGE_KEY. Imported by value there,
// but this module only needs the string to read and retire the old copy.
const LEGACY_BRAND_KIT_KEY = "truepane-brand-kits-v1";

export type StorageMode = "indexeddb" | "localstorage";

export interface LoadResult {
  state: AppState;
  brandKits: BrandKit[];
  mode: StorageMode;
  /** True when this load moved a project out of localStorage. */
  migrated: boolean;
}

interface MigrationMarker {
  migratedAt: string;
  /** The localStorage source is retired only after a *later* session reads the
   * migrated document back successfully. */
  legacyCleared: boolean;
}

/** Brand kits with their font externalized. `assetId` keys are what
 * `referencedAssetIds` collects, so GC sees these as roots for free. */
type StoredBrandKits = { version: 1; kits: unknown[] };

// ---------------------------------------------------------------------------
// Asset resolution
// ---------------------------------------------------------------------------

async function resolverFor(ids: Iterable<string>): Promise<(id: string) => string | null> {
  const resolved = new Map<string, string>();
  await Promise.all(
    [...ids].map(async (id) => {
      const blob = await getAsset(id);
      if (blob) resolved.set(id, await blobToDataUrl(blob));
    }),
  );
  return (id) => resolved.get(id) ?? null;
}

async function writeAssets(blobs: Map<string, string>): Promise<void> {
  // Assets before the document, always. A dead asset is garbage the sweep
  // collects; a document pointing at an unwritten asset is a broken project.
  for (const [, dataUrl] of blobs) await putAsset(dataUrlToBlob(dataUrl));
}

// ---------------------------------------------------------------------------
// Brand kits
// ---------------------------------------------------------------------------

async function externalizeBrandKits(
  kits: BrandKit[],
): Promise<{ stored: StoredBrandKits; blobs: Map<string, string> }> {
  const blobs = new Map<string, string>();
  const stored = await Promise.all(
    kits.map(async (kit) => {
      const font = kit.style.customFont;
      if (!font?.dataUrl) return { ...kit, style: { ...kit.style, customFont: null } };
      const id = await assetId(dataUrlToBlob(font.dataUrl));
      blobs.set(id, font.dataUrl);
      return { ...kit, style: { ...kit.style, customFont: { name: font.name, assetId: id } } };
    }),
  );
  return { stored: { version: 1, kits: stored }, blobs };
}

function internalizeBrandKits(
  stored: StoredBrandKits | null,
  resolve: (id: string) => string | null,
): BrandKit[] {
  if (!stored?.kits) return [];
  const kits: BrandKit[] = [];
  for (const raw of stored.kits) {
    const kit = raw as { style?: { customFont?: { name: string; assetId: string } | null } };
    const ref = kit.style?.customFont;
    const dataUrl = ref && "assetId" in ref ? resolve(ref.assetId) : null;
    try {
      kits.push(
        normalizeBrandKit({
          ...(raw as object),
          style: {
            ...(kit.style as object),
            customFont: ref && dataUrl ? { name: ref.name, dataUrl } : null,
          },
        }),
      );
    } catch {
      // A malformed kit must not take the whole app down on load.
    }
  }
  return kits;
}

// ---------------------------------------------------------------------------
// Garbage collection
// ---------------------------------------------------------------------------

/**
 * Deletes assets no longer reachable from the project or the brand kits.
 *
 * Without this, deleting a slide or replacing a screenshot leaks its bytes
 * forever and this whole change trades a hard 5MB ceiling for an unbounded
 * one. Brand kits are roots too — sweeping with only the project in hand would
 * delete every saved kit's font.
 */
export async function sweepAssets(): Promise<number> {
  const [project, kits] = await Promise.all([
    getDocument<StoredDocument>(PROJECT_KEY),
    getDocument<StoredBrandKits>(BRAND_KITS_KEY),
  ]);
  const live = new Set<string>();
  if (project) for (const id of referencedAssetIds(project)) live.add(id);
  if (kits) for (const id of referencedAssetIds(kits as unknown as StoredDocument)) live.add(id);
  const orphans = (await listAssetIds()).filter((id) => !live.has(id));
  if (orphans.length) await deleteAssets(orphans);
  return orphans.length;
}

// ---------------------------------------------------------------------------
// Load
// ---------------------------------------------------------------------------

function loadLegacyState(): AppState | null {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    return normalizeAppState(JSON.parse(raw));
  } catch {
    return null;
  }
}

function loadLegacyBrandKits(): BrandKit[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(LEGACY_BRAND_KIT_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.map(normalizeBrandKit) : [];
  } catch {
    return [];
  }
}

// StrictMode invokes the init effect twice. Sharing one in-flight promise makes
// load — and therefore migration, and therefore retiring the localStorage
// source — happen exactly once per session. A boolean set after the fact would
// not: both invocations would race past it before either finished.
let inFlight: Promise<LoadResult> | null = null;

export function loadProject(): Promise<LoadResult> {
  if (!inFlight) {
    inFlight = load().catch((error) => {
      inFlight = null; // a failed load must not be cached as the answer
      throw error;
    });
  }
  return inFlight;
}

/**
 * One load, unmemoized. `loadProject` is what the app calls; this exists so a
 * test can simulate consecutive *sessions*, which is the only way to exercise
 * the two-phase migration (write in one session, retire the localStorage source
 * in a later one).
 */
export async function loadProjectUncached(): Promise<LoadResult> {
  return load();
}

async function load(): Promise<LoadResult> {
  try {
    await openDb();
  } catch {
    // Private browsing, disabled storage, policy. The editor must still open.
    return {
      state: loadLegacyState() ?? normalizeAppState({}),
      brandKits: loadLegacyBrandKits(),
      mode: "localstorage",
      migrated: false,
    };
  }

  const [document, storedKits, marker] = await Promise.all([
    getDocument<StoredDocument>(PROJECT_KEY),
    getDocument<StoredBrandKits>(BRAND_KITS_KEY),
    getDocument<MigrationMarker>(MIGRATION_KEY),
  ]);

  if (!document) {
    const legacy = loadLegacyState();
    const legacyKits = loadLegacyBrandKits();
    if (legacy) {
      await save(legacy, legacyKits);
      await putDocument(MIGRATION_KEY, {
        migratedAt: new Date().toISOString(),
        legacyCleared: false,
      } satisfies MigrationMarker);
      // Deliberately NOT clearing localStorage here. The migration has been
      // written but never read back; retiring the only other copy in the same
      // session is how a migration becomes a data-loss incident.
      return { state: legacy, brandKits: legacyKits, mode: "indexeddb", migrated: true };
    }
    return {
      state: normalizeAppState({}),
      brandKits: legacyKits,
      mode: "indexeddb",
      migrated: false,
    };
  }

  const ids = referencedAssetIds(document);
  if (storedKits) for (const id of referencedAssetIds(storedKits as unknown as StoredDocument)) ids.add(id);
  const resolve = await resolverFor(ids);
  const state = internalizeAssets(document, resolve);
  const brandKits = internalizeBrandKits(storedKits, resolve);

  // A document was read back successfully. That is the proof the migration
  // survived, so the localStorage source can finally be retired.
  if (marker && !marker.legacyCleared) {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(LEGACY_BRAND_KIT_KEY);
    await putDocument(MIGRATION_KEY, { ...marker, legacyCleared: true } satisfies MigrationMarker);
  }

  return { state, brandKits, mode: "indexeddb", migrated: false };
}

// ---------------------------------------------------------------------------
// Save
// ---------------------------------------------------------------------------

async function save(state: AppState, brandKits: BrandKit[]): Promise<void> {
  const { document, blobs } = await externalizeAssets(state);
  const kits = await externalizeBrandKits(brandKits);
  await writeAssets(blobs);
  await writeAssets(kits.blobs);
  await putDocument(PROJECT_KEY, document);
  await putDocument(BRAND_KITS_KEY, kits.stored);
}

/** Persists the project. Throws on failure — the caller must surface it. */
export async function saveProject(
  state: AppState,
  brandKits: BrandKit[],
  mode: StorageMode,
): Promise<void> {
  if (mode === "localstorage") {
    // Fallback keeps the original single-key behaviour, quota and all.
    localStorage.setItem(STORAGE_KEY, JSON.stringify(legacyPayload(state)));
    localStorage.setItem(LEGACY_BRAND_KIT_KEY, JSON.stringify(brandKits));
    return;
  }
  await save(state, brandKits);
  await sweepAssets();
}

// Byte-for-byte the payload the pre-IndexedDB build wrote, media included.
// Dropping `media` here would silently discard every screenshot for users in
// fallback mode.
function legacyPayload(state: AppState): unknown {
  return {
    version: 2,
    settings: state.settings,
    releaseBaseline: state.releaseBaseline,
    slides: state.slides.map((slide) => ({
      title: slide.title,
      subhead: slide.subhead,
      media: serializeMedia(slide.media),
      background: slide.background,
      composition: slide.composition,
      deviceSpan: slide.deviceSpan,
      translations: serializeTranslations(slide.translations),
    })),
  };
}

// ---------------------------------------------------------------------------
// Durability / headroom
// ---------------------------------------------------------------------------

export async function requestPersistence(): Promise<boolean> {
  try {
    if (!navigator.storage?.persist) return false;
    if (await navigator.storage.persisted?.()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

export async function storageEstimate(): Promise<{ usage: number; quota: number } | null> {
  try {
    if (!navigator.storage?.estimate) return null;
    const { usage, quota } = await navigator.storage.estimate();
    return typeof usage === "number" && typeof quota === "number" ? { usage, quota } : null;
  } catch {
    return null;
  }
}
