import { describe, expect, it } from "vitest";
import { normalizeAppState } from "../core/normalize";
import { externalizeAssets, internalizeAssets, referencedAssetIds } from "./document";

const dataUrl = (mime: string, body: string) => `data:${mime};base64,${btoa(body)}`;
const SHOT_A = dataUrl("image/png", "screenshot-alpha");
const SHOT_B = dataUrl("image/png", "screenshot-beta");
const FONT = dataUrl("font/woff2", "font-bytes");

function project(overrides: Record<string, unknown> = {}) {
  return normalizeAppState({
    settings: {
      platform: "ios",
      targets: ["ios", "android"],
      customFont: { name: "Brand Sans", dataUrl: FONT },
      languages: [{ code: "de", name: "German" }],
    },
    slides: [
      {
        title: "One",
        subhead: "first",
        media: {
          ios: {
            source: { imageDataUrl: SHOT_A, width: 1290, height: 2796 },
            locales: { de: { imageDataUrl: SHOT_B, width: 1290, height: 2796 } },
          },
          android: { source: { imageDataUrl: SHOT_A } },
        },
        translations: { de: { title: "Eins", subhead: "erstes" } },
      },
      { title: "Two", subhead: "second" },
    ],
    releaseBaseline: {
      version: 1,
      rendererVersion: 2,
      createdAt: "2026-01-01T00:00:00.000Z",
      signatures: { "ios/native/source/slide-01": "abc" },
    },
    ...overrides,
  });
}

describe("externalize/internalize", () => {
  // A lossy round-trip here is silent corruption of the user's project on every
  // save: the document is what gets written, and this is what reads it back.
  it("round-trips a project to a deep-equal state", async () => {
    const state = project();
    const { document, blobs } = await externalizeAssets(state);
    expect(internalizeAssets(document, (id) => blobs.get(id) ?? null)).toEqual(state);
  });

  it("keeps binaries out of the document", async () => {
    const { document } = await externalizeAssets(project());
    expect(JSON.stringify(document)).not.toContain("base64");
  });

  // mirrorSpannedMedia copies one screenshot onto its partner slide, and every
  // locale falling back to the source is another copy. Without content
  // addressing the store holds one copy per reference.
  it("stores identical screenshot bytes once", async () => {
    const state = normalizeAppState({
      settings: { platform: "ios", customFont: null },
      slides: [
        { title: "One", subhead: "", media: { ios: { source: { imageDataUrl: SHOT_A } } } },
        { title: "Two", subhead: "", media: { ios: { source: { imageDataUrl: SHOT_A } } } },
      ],
    });
    const { document, blobs } = await externalizeAssets(state);
    expect(blobs.size).toBe(1);
    expect(document.slides[0].media?.ios.source?.assetId).toBe(
      document.slides[1].media?.ios.source?.assetId,
    );
  });

  // Ids are a hash of the bytes, not of the encoding, so the same image saved
  // under a different mime label is still one asset.
  it("keys assets by bytes, not by the data URL string", async () => {
    const state = normalizeAppState({
      settings: { platform: "ios", customFont: null },
      slides: [
        { title: "One", subhead: "", media: { ios: { source: { imageDataUrl: SHOT_A } } } },
        {
          title: "Two",
          subhead: "",
          media: { ios: { source: { imageDataUrl: dataUrl("image/jpeg", "screenshot-alpha") } } },
        },
      ],
    });
    const { blobs } = await externalizeAssets(state);
    expect(blobs.size).toBe(1);
  });
});

describe("referencedAssetIds", () => {
  // Garbage collection deletes every id this does not return. A field missed
  // here deletes a live screenshot.
  it("returns every id the document references", async () => {
    const { document, blobs } = await externalizeAssets(project());
    expect(blobs.size).toBe(3); // source, locale, custom font
    expect(referencedAssetIds(document)).toEqual(new Set(blobs.keys()));
  });

  // The walk is structural rather than a list of known fields, so an
  // asset-bearing field added later (Plan 008's background images) is collected
  // without touching this function.
  it("finds ids in fields it was never told about", async () => {
    const { document } = await externalizeAssets(project());
    const extended = {
      ...document,
      settings: { ...document.settings, background: { ...document.settings.background, image: { assetId: "future" } } },
    } as unknown as Parameters<typeof referencedAssetIds>[0];
    expect(referencedAssetIds(extended).has("future")).toBe(true);
  });
});

describe("missing assets", () => {
  // A partially evicted database must degrade to a placeholder slide, not to a
  // blank app or a thrown error on load.
  it("internalizes an unresolvable asset as a slide with no image", async () => {
    const { document, blobs } = await externalizeAssets(project());
    const fontId = document.settings.customFont?.assetId;
    const state = internalizeAssets(document, (id) =>
      id === document.slides[0].media?.ios.source?.assetId ? null : blobs.get(id) ?? null,
    );
    expect(state.slides).toHaveLength(2);
    expect(state.slides[0].title).toBe("One");
    expect(state.slides[0].media?.ios.source).toBeUndefined();
    expect(state.slides[0].media?.ios.locales?.de.imageDataUrl).toBe(SHOT_B);
    expect(fontId).toBeTruthy();
  });

  it("drops a custom font whose asset is gone", async () => {
    const { document } = await externalizeAssets(project());
    expect(internalizeAssets(document, () => null).settings.customFont).toBeNull();
  });
});

// A custom backdrop is the largest asset the app can hold and it is shared by
// every slide that does not override it. Leaving it inline would rewrite those
// megabytes into the document on every debounced save.
describe("background images", () => {
  const BACKDROP = dataUrl("image/jpeg", "backdrop-bytes");
  const image = (source: { dataUrl: string }) => ({
    source: { kind: "upload", id: "ignored", dataUrl: source.dataUrl, width: 3960, height: 2868 },
    span: "strip",
    fit: "cover",
    opacity: 0.9,
    scrim: 0.25,
    scrimColor: "#101010",
    meanLuminance: 0.31,
  });

  const withBackdrop = () =>
    project({
      settings: {
        platform: "ios",
        customFont: null,
        background: { color: "#ffffff", image: image({ dataUrl: BACKDROP }) },
      },
    });

  it("round-trips a background image without embedding its bytes", async () => {
    const state = withBackdrop();
    expect(state.settings.background.image?.source.kind).toBe("upload");
    const { document, blobs } = await externalizeAssets(state);
    expect(JSON.stringify(document)).not.toContain("base64");
    expect(internalizeAssets(document, (id) => blobs.get(id) ?? null)).toEqual(state);
  });

  it("is reachable from referencedAssetIds, so the sweep cannot delete it", async () => {
    const { document, blobs } = await externalizeAssets(withBackdrop());
    const ids = referencedAssetIds(document);
    for (const id of blobs.keys()) expect(ids.has(id)).toBe(true);
  });

  it("degrades to no image when the asset is gone, rather than a dead reference", async () => {
    const { document } = await externalizeAssets(withBackdrop());
    const state = internalizeAssets(document, () => null);
    expect(state.settings.background.image).toBeUndefined();
    expect(state.settings.background.color).toBe("#ffffff");
  });

  it("shares one asset between a slide override and the global background", async () => {
    const state = normalizeAppState({
      settings: {
        platform: "ios",
        customFont: null,
        background: { image: image({ dataUrl: BACKDROP }) },
      },
      slides: [
        { title: "One", subhead: "", background: { image: image({ dataUrl: BACKDROP }) } },
        { title: "Two", subhead: "" },
      ],
    });
    const { blobs } = await externalizeAssets(state);
    expect(blobs.size).toBe(1);
  });
});
