import { describe, expect, it } from "vitest";
import {
  normalizeOutput,
  outputForSettings,
  safeOutputDimensions,
  validateCustomOutputDimensions,
} from "./output";
import { defaultState } from "./constants";

describe("output specs", () => {
  it("preserves legacy native dimensions when output is absent", () => {
    const settings = defaultState().settings;
    expect(outputForSettings(settings)).toMatchObject({ id: "ios", width: 1320, height: 2868 });
  });

  it("normalizes the Play feature graphic", () => {
    expect(normalizeOutput({ id: "play-feature", frame: "android-tablet" })).toMatchObject({
      width: 1024,
      height: 500,
      frame: "android-tablet",
      kind: "feature",
    });
  });

  it("bounds custom canvas memory", () => {
    const dimensions = safeOutputDimensions(100_000, 100_000);
    expect(dimensions.width).toBeLessThanOrEqual(8192);
    expect(dimensions.height).toBeLessThanOrEqual(8192);
    expect(dimensions.width * dimensions.height).toBeLessThanOrEqual(40_000_000);
  });

  it("keeps incomplete custom dimensions invalid instead of coercing them while the user types", () => {
    expect(validateCustomOutputDimensions("", "1920")).toEqual({
      error: "Enter both width and height.",
    });
    expect(validateCustomOutputDimensions("1000", "1920")).toEqual({
      width: 1000,
      height: 1920,
    });
  });

  it("explains custom output limits before committing a destructive clamp", () => {
    expect(validateCustomOutputDimensions("9000", "1000")).toEqual({
      error: "Use dimensions from 320 to 8192 px.",
    });
    expect(validateCustomOutputDimensions("8192", "8192")).toEqual({
      error: "Custom output must stay at or below 40 megapixels.",
    });
  });
});
