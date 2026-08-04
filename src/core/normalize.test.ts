import { describe, expect, it } from "vitest";
import { getImageAsset } from "./media";
import { normalizeAppState, normalizeBackground } from "./normalize";
import { DEFAULT_CUSTOM_SHAPE } from "./constants";

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
    span: "strip", fit: "contain", blur: 0.25, opacity: 0.8, scrim: 0.4, scrimColor: "#ffffff", meanLuminance: 0.3,
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

  // Screenshot-derived backgrounds predate the shared blur field. Migrating
  // their value preserves their pixels while new uploads use the same control.
  it("migrates legacy screenshot blur while forcing slide span and cover", () => {
    const img = normalizeBackground({
      image: { source: { kind: "screenshot", blur: 0.7 }, span: "strip", fit: "contain" },
    }).image!;
    expect(img.source).toEqual({ kind: "screenshot", blur: 0.7 });
    expect(img.blur).toBe(0.7);
    expect(img.span).toBe("slide");
    expect(img.fit).toBe("cover");
  });

  it("defaults uploaded background blur to zero and clamps explicit values", () => {
    expect(normalizeBackground({ image: { ...upload, blur: undefined } }).image?.blur).toBe(0);
    expect(normalizeBackground({ image: { ...upload, blur: 4 } }).image?.blur).toBe(1);
  });
});

// The custom shape family is the surface an agent drives directly, so every
// field is a hostile-input boundary. Clamping rather than rejecting matters
// because a sloppy call should still render something instead of failing the
// whole style patch and stalling the agent.
describe("custom shape normalization", () => {
  it("leaves customShape absent when a project never used the family", () => {
    // Absent stays absent: a project that predates the family must serialize
    // exactly as before, or every stored release baseline is invalidated.
    expect(normalizeBackground({ shape: "rings" }).customShape).toBeUndefined();
    expect(normalizeBackground({ customShape: "nonsense" }).customShape).toBeUndefined();
  });

  it("clamps out-of-range numbers into their documented range", () => {
    const c = normalizeBackground({
      customShape: {
        count: 1e9,
        size: 40,
        sizeJitter: -3,
        rotation: 10000,
        rotationJitter: -5,
        spacingX: 0,
        spacingY: 900,
        phase: 7,
        strokeWidth: -12,
        opacityRamp: 50,
      },
    }).customShape!;
    // count is the allocation bound — it must be clamped before anything reads it.
    expect(c.count).toBe(200);
    expect(c.size).toBe(1);
    expect(c.sizeJitter).toBe(0);
    expect(c.rotation).toBe(180);
    expect(c.rotationJitter).toBe(0);
    // A zero lattice step is degenerate, so spacing has a hard non-zero floor.
    expect(c.spacingX).toBe(0.02);
    expect(c.spacingY).toBe(2);
    expect(c.phase).toBe(1);
    expect(c.strokeWidth).toBe(0);
    expect(c.opacityRamp).toBe(1);
  });

  it("falls back to defaults for NaN, non-numbers and unknown enum values", () => {
    const c = normalizeBackground({
      customShape: {
        primitive: "hexagon",
        layout: "spiral",
        count: NaN,
        size: "big",
        spacingX: Infinity,
      },
    }).customShape!;
    expect(c.primitive).toBe(DEFAULT_CUSTOM_SHAPE.primitive);
    expect(c.layout).toBe(DEFAULT_CUSTOM_SHAPE.layout);
    expect(c.count).toBe(DEFAULT_CUSTOM_SHAPE.count);
    expect(c.size).toBe(DEFAULT_CUSTOM_SHAPE.size);
    expect(c.spacingX).toBe(DEFAULT_CUSTOM_SHAPE.spacingX);
  });

  it("keeps a partial spec's valid fields and fills the rest from defaults", () => {
    // An agent patching one knob must not have the other eleven wiped.
    const c = normalizeBackground({ customShape: { primitive: "triangle", count: 42 } }).customShape!;
    expect(c.primitive).toBe("triangle");
    expect(c.count).toBe(42);
    expect(c.spacingX).toBe(DEFAULT_CUSTOM_SHAPE.spacingX);
  });
});
