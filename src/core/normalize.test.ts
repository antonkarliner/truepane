import { describe, expect, it } from "vitest";
import { getImageAsset } from "./media";
import { normalizeAppState } from "./normalize";

describe("project v2 media normalization", () => {
  it("migrates v1 source and locale screenshots into the active target", () => {
    const state = normalizeAppState({
      settings: { platform: "android" },
      slides: [{
        title: "One",
        subhead: "",
        imageDataUrl: "data:image/png;base64,source",
        translations: {
          fr: { title: "Un", subhead: "", imageDataUrl: "data:image/png;base64,fr" },
        },
      }],
    });
    expect(state.settings.targets).toEqual(["android"]);
    expect(getImageAsset(state.slides[0], "android").imageDataUrl).toContain("source");
    expect(getImageAsset(state.slides[0], "android", "fr").imageDataUrl).toContain("fr");
  });

  it("keeps v2 targets separate and never falls back across platforms", () => {
    const state = normalizeAppState({
      settings: { platform: "ios", targets: ["ios", "android"] },
      slides: [{
        title: "One",
        subhead: "",
        media: {
          ios: { source: { imageDataUrl: "data:image/png;base64,ios" } },
        },
      }],
    });
    expect(getImageAsset(state.slides[0], "ios").imageDataUrl).toContain("ios");
    expect(getImageAsset(state.slides[0], "android").imageDataUrl).toBeNull();
  });

  it("falls a missing locale back to the source image of the same target", () => {
    const state = normalizeAppState({
      settings: { platform: "ios" },
      slides: [{
        title: "One",
        subhead: "",
        media: {
          ios: { source: { imageDataUrl: "data:image/png;base64,source" } },
        },
      }],
    });
    expect(getImageAsset(state.slides[0], "ios", "de").imageDataUrl).toContain("source");
  });
});
