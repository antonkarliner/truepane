// Document <-> asset mapping. Pure functions: they swap embedded data URLs for
// content ids on the way into storage and back on the way out, so the document
// stays small and JSON-cheap while the binaries live in the asset store.
//
// The exported project format is deliberately untouched — a `.truepane` file
// keeps embedding data URLs via serializeMedia / normalizeAppState. This layer
// exists only between the app and IndexedDB.
import { serializeMedia } from "../core/media";
import { normalizeAppState, serializeTranslations } from "../core/normalize";
import type {
  AppState,
  Background,
  Composition,
  ReleaseBaseline,
  Settings,
  Slide,
  SlideText,
} from "../core/types";
import { assetId, dataUrlToBlob } from "./assets";

/** An image reference: the content id in place of `imageDataUrl`. */
export interface StoredImageRef {
  assetId: string;
  width?: number;
  height?: number;
}

export interface StoredTargetMedia {
  source?: StoredImageRef;
  locales?: Record<string, StoredImageRef>;
}

export interface StoredCustomFont {
  name: string;
  assetId: string;
}

export type StoredSettings = Omit<Settings, "customFont"> & {
  customFont: StoredCustomFont | null;
};

export interface StoredSlide {
  title: string;
  subhead: string;
  media?: Record<string, StoredTargetMedia>;
  background?: Background;
  composition?: Composition;
  deviceSpan?: Slide["deviceSpan"];
  translations?: Record<string, SlideText>;
}

export interface StoredDocument {
  /** Storage schema version, independent of the exported project format. */
  version: 1;
  settings: StoredSettings;
  releaseBaseline?: ReleaseBaseline;
  slides: StoredSlide[];
}

export interface ExternalizedState {
  document: StoredDocument;
  /** Asset id -> data URL, for the caller to write to the asset store. */
  blobs: Map<string, string>;
}

/**
 * Splits a project into an asset-referencing document plus the assets it
 * references. Async because the content id is a SHA-256 of the asset bytes.
 */
export async function externalizeAssets(state: AppState): Promise<ExternalizedState> {
  const blobs = new Map<string, string>();
  const ids = new Map<string, Promise<string>>();
  // Identical content hashes to one id; caching by data URL also keeps the
  // common case (a spanned device mirrored onto its partner slide) from
  // re-hashing the same megabytes twice per save.
  const intern = (dataUrl: string): Promise<string> => {
    let pending = ids.get(dataUrl);
    if (!pending) {
      pending = assetId(dataUrlToBlob(dataUrl)).then((id) => {
        blobs.set(id, dataUrl);
        return id;
      });
      ids.set(dataUrl, pending);
    }
    return pending;
  };

  const slides: StoredSlide[] = [];
  for (const slide of state.slides) {
    slides.push({
      title: slide.title,
      subhead: slide.subhead,
      media: await externalizeMedia(slide.media, intern),
      background: slide.background,
      composition: slide.composition,
      deviceSpan: slide.deviceSpan,
      translations: serializeTranslations(slide.translations),
    });
  }

  const font = state.settings.customFont;
  const customFont: StoredCustomFont | null = font?.dataUrl
    ? { name: font.name, assetId: await intern(font.dataUrl) }
    : null;

  return {
    document: {
      version: 1,
      settings: { ...state.settings, customFont },
      releaseBaseline: state.releaseBaseline,
      slides,
    },
    blobs,
  };
}

// Walks exactly the fields serializeMedia walks, by walking its output: any
// media field it persists is a field this externalizes. Plan 008's
// settings.background.image / slide.background.image attach alongside, in
// externalizeAssets and internalizeAssets.
async function externalizeMedia(
  media: Slide["media"],
  intern: (dataUrl: string) => Promise<string>,
): Promise<Record<string, StoredTargetMedia> | undefined> {
  const serialized = serializeMedia(media);
  if (!serialized) return undefined;
  const out: Record<string, StoredTargetMedia> = {};
  for (const [target, value] of Object.entries(serialized)) {
    const source: StoredImageRef | undefined = value.source?.imageDataUrl
      ? {
          assetId: await intern(value.source.imageDataUrl),
          width: value.source.width,
          height: value.source.height,
        }
      : undefined;
    const locales: Record<string, StoredImageRef> = {};
    for (const [code, asset] of Object.entries(value.locales ?? {})) {
      if (!asset.imageDataUrl) continue;
      locales[code] = {
        assetId: await intern(asset.imageDataUrl),
        width: asset.width,
        height: asset.height,
      };
    }
    out[target] = {
      ...(source ? { source } : {}),
      ...(Object.keys(locales).length ? { locales } : {}),
    };
  }
  return out;
}

/**
 * Rebuilds a project from a document, resolving each asset id to a data URL.
 * `resolve` returning null (an evicted or never-written asset) drops that one
 * image: the project must degrade to a placeholder, never fail to open.
 */
export function internalizeAssets(
  document: StoredDocument,
  resolve: (id: string) => string | null,
): AppState {
  const font = document.settings.customFont;
  const fontDataUrl = font ? resolve(font.assetId) : null;
  return normalizeAppState({
    settings: {
      ...document.settings,
      customFont: font && fontDataUrl ? { name: font.name, dataUrl: fontDataUrl } : null,
    },
    releaseBaseline: document.releaseBaseline,
    slides: document.slides.map((slide) => ({
      ...slide,
      media: internalizeMedia(slide.media, resolve),
    })),
  });
}

function internalizeMedia(
  media: Record<string, StoredTargetMedia> | undefined,
  resolve: (id: string) => string | null,
): Record<string, unknown> | undefined {
  if (!media) return undefined;
  const out: Record<string, unknown> = {};
  for (const [target, value] of Object.entries(media)) {
    const sourceUrl = value.source ? resolve(value.source.assetId) : null;
    const locales: Record<string, unknown> = {};
    for (const [code, ref] of Object.entries(value.locales ?? {})) {
      const url = resolve(ref.assetId);
      if (url) locales[code] = { imageDataUrl: url, width: ref.width, height: ref.height };
    }
    out[target] = {
      ...(sourceUrl
        ? { source: { imageDataUrl: sourceUrl, width: value.source?.width, height: value.source?.height } }
        : {}),
      ...(Object.keys(locales).length ? { locales } : {}),
    };
  }
  return out;
}

/**
 * Every asset id reachable from a document.
 *
 * Garbage collection deletes whatever this does not return, so a field missed
 * here is a deleted screenshot. That is why this traverses the document
 * structurally rather than enumerating known fields: any future asset-bearing
 * field is collected the moment it is added, without editing this function.
 */
export function referencedAssetIds(document: StoredDocument): Set<string> {
  const ids = new Set<string>();
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (key === "assetId" && typeof child === "string" && child) ids.add(child);
      else visit(child);
    }
  };
  visit(document);
  return ids;
}
