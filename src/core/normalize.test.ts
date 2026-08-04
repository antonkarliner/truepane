import { describe, expect, it } from "vitest";
import { getImageAsset } from "./media";
import { normalizeAppState, normalizeBackground } from "./normalize";

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

describe("normalizeBackground image layer", () => {
  const upload = {
    source: { kind: "upload", id: "abc", dataUrl: "data:image/jpeg;base64,x", width: 100, height: 50 },
    span: "strip", fit: "contain", opacity: 0.8, scrim: 0.4, scrimColor: "#ffffff", meanLuminance: 0.3,
  };

  // A project saved before this feature must serialize byte-identically to
  // before, or every existing release baseline signature changes.
  it("leaves the field absent when no image is set", () => {
    expect("image" in normalizeBackground({ fill: "solid" })).toBe(false);
  });

  it("round-trips a full upload layer", () => {
    expect(normalizeBackground({ image: upload }).image).toEqual(upload);
  });

  // Agents will send junk over MCP; clamping beats trusting or throwing.
  it("clamps out-of-range numbers instead of honoring them", () => {
    const img = normalizeBackground({
      image: { ...upload, opacity: 12, scrim: -5, meanLuminance: 99 },
    }).image!;
    expect(img.opacity).toBe(1);
    expect(img.scrim).toBe(0);
    expect(img.meanLuminance).toBe(1);
  });

  it("drops an image whose source cannot be described", () => {
    expect(normalizeBackground({ image: { span: "strip" } }).image).toBeUndefined();
    expect(normalizeBackground({ image: { source: { kind: "upload" } } }).image).toBeUndefined();
    expect(normalizeBackground({ image: "nonsense" }).image).toBeUndefined();
  });

  // A screenshot-derived background is the slide's own screenshot. Slicing it
  // across the strip would be meaningless, so span/fit are forced.
  it("forces a screenshot-derived layer to slide span and cover", () => {
    const img = normalizeBackground({
      image: { source: { kind: "screenshot", blur: 0.7 }, span: "strip", fit: "contain" },
    }).image!;
    expect(img.source).toEqual({ kind: "screenshot", blur: 0.7 });
    expect(img.span).toBe("slide");
    expect(img.fit).toBe("cover");
  });
});
