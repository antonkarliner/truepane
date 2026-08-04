// Node has Blob and localStorage but no FileReader, which blobToDataUrl needs.
class NodeFileReader {
  result: string | null = null;
  error: unknown = null;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  readAsDataURL(blob: Blob): void {
    void blob.arrayBuffer().then((buffer) => {
      const base64 = Buffer.from(buffer).toString("base64");
      this.result = `data:${blob.type || "application/octet-stream"};base64,${base64}`;
      this.onload?.();
    });
  }
}
(globalThis as unknown as { FileReader: unknown }).FileReader = NodeFileReader;

// Node exposes a `localStorage` object that is not a real Storage (no clear()).
// Replace it outright so the tests drive the same API the browser gives us.
const store = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: (i: number) => [...store.keys()][i] ?? null,
    get length() {
      return store.size;
    },
  },
});

import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { brandKitFromSettings } from "../core/brand-kit";
import { defaultState } from "../core/constants";
import { setImageAsset } from "../core/media";
import { listAssetIds } from "./assets";
import { loadProjectUncached, saveProject, sweepAssets } from "./project";

const STORAGE_KEY = "appstore-generator-v1";
const BRAND_KIT_KEY = "truepane-brand-kits-v1";

const png = (body: string) => `data:image/png;base64,${btoa(body)}`;
const font = (body: string) => `data:font/woff2;base64,${btoa(body)}`;

function legacyProject(imageDataUrl: string) {
  return JSON.stringify({
    version: 2,
    settings: { platform: "ios", customFont: null },
    slides: [
      { title: "Legacy one", subhead: "from localStorage", media: { ios: { source: { imageDataUrl } } } },
      { title: "Legacy two", subhead: "" },
    ],
  });
}

async function freshDb(): Promise<void> {
  // fake-indexeddb keeps one global instance per process; drop it between tests
  // so each case starts from an empty store.
  const { IDBFactory } = await import("fake-indexeddb");
  (globalThis as unknown as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
  // The assets module memoizes its open promise; re-import it fresh.
  await import("./assets").then((m) => m.resetDbForTests?.());
}

beforeEach(async () => {
  localStorage.clear();
  await freshDb();
});

describe("localStorage migration", () => {
  // Retiring the only other copy of a user's project in the same session that
  // wrote the new one is exactly how a migration becomes a data-loss incident:
  // the new copy has been written but never proven readable.
  it("keeps the localStorage copy during the session that migrates", async () => {
    localStorage.setItem(STORAGE_KEY, legacyProject(png("legacy-shot")));

    const first = await loadProjectUncached();

    expect(first.migrated).toBe(true);
    expect(first.state.slides[0].title).toBe("Legacy one");
    expect(localStorage.getItem(STORAGE_KEY), "source retired too early").not.toBeNull();
  });

  it("retires the localStorage copy only once a later session reads it back", async () => {
    localStorage.setItem(STORAGE_KEY, legacyProject(png("legacy-shot")));
    localStorage.setItem(
      BRAND_KIT_KEY,
      JSON.stringify([brandKitFromSettings("Legacy kit", defaultState().settings, "kit-legacy")]),
    );
    const first = await loadProjectUncached();
    expect(first.brandKits, "legacy kits must survive the migration").toHaveLength(1);

    const second = await loadProjectUncached();

    expect(second.migrated).toBe(false);
    expect(second.state.slides[0].title).toBe("Legacy one");
    expect(second.state.slides[0].media?.ios?.source?.imageDataUrl).toBe(png("legacy-shot"));
    expect(second.brandKits).toHaveLength(1);
    // Both legacy keys go, and only now.
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(localStorage.getItem(BRAND_KIT_KEY)).toBeNull();
  });

  it("survives a corrupt localStorage payload instead of failing to open", async () => {
    localStorage.setItem(STORAGE_KEY, "{not json");
    const result = await loadProjectUncached();
    expect(result.state.slides.length).toBeGreaterThan(0);
  });
});

describe("save/load round trip", () => {
  it("restores screenshots and brand kits through the asset store", async () => {
    const state = defaultState();
    state.slides[0] = setImageAsset(state.slides[0], "ios", "", {
      imageDataUrl: png("shot-a"),
      image: null,
    });
    state.settings.customFont = { name: "Brand Sans", dataUrl: font("brand") };
    const kit = brandKitFromSettings("Kit", state.settings, "kit-1");

    await saveProject(state, [kit], "indexeddb");
    const loaded = await loadProjectUncached();

    expect(loaded.state.slides[0].media?.ios?.source?.imageDataUrl).toBe(png("shot-a"));
    expect(loaded.state.settings.customFont?.dataUrl).toBe(font("brand"));
    expect(loaded.brandKits).toHaveLength(1);
    expect(loaded.brandKits[0].style.customFont?.dataUrl).toBe(font("brand"));
  });
});

describe("garbage collection", () => {
  it("deletes assets a slide no longer references", async () => {
    const state = defaultState();
    state.slides[0] = setImageAsset(state.slides[0], "ios", "", { imageDataUrl: png("old"), image: null });
    await saveProject(state, [], "indexeddb");
    expect(await listAssetIds()).toHaveLength(1);

    state.slides[0] = setImageAsset(state.slides[0], "ios", "", { imageDataUrl: png("new"), image: null });
    await saveProject(state, [], "indexeddb");

    const ids = await listAssetIds();
    expect(ids, "replacing a screenshot must not leak the old bytes").toHaveLength(1);
  });

  // The sweep runs with only the project in hand unless brand kits are treated
  // as roots too — in which case every saved kit's font is deleted underneath
  // the user the next time they touch a slide.
  it("treats brand kit fonts as live roots", async () => {
    const state = defaultState();
    state.settings.customFont = { name: "Kit Font", dataUrl: font("kit-only") };
    const kit = brandKitFromSettings("Kit", state.settings, "kit-1");

    const bare = defaultState(); // project itself references no font
    await saveProject(bare, [kit], "indexeddb");
    await sweepAssets();

    const loaded = await loadProjectUncached();
    expect(loaded.brandKits[0]?.style.customFont?.dataUrl).toBe(font("kit-only"));
  });

  it("reports orphans it collected", async () => {
    const state = defaultState();
    state.slides[0] = setImageAsset(state.slides[0], "ios", "", { imageDataUrl: png("x"), image: null });
    await saveProject(state, [], "indexeddb");
    expect(await sweepAssets()).toBe(0);
  });
});
