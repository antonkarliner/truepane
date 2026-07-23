import { describe, expect, it } from "vitest";
import { normalizeOutput, outputForSettings, safeOutputDimensions } from "./output";
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
});
