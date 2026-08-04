import { describe, expect, it } from "vitest";
import {
  backgroundImageTargetSize,
  MAX_BG_IMAGE_DIM,
  MAX_BG_IMAGE_PIXELS,
} from "./background-image";

// The destination box for a 6-slide iPhone strip.
const STRIP_BOX = { width: 1320 * 6, height: 2868 };

describe("backgroundImageTargetSize", () => {
  it("never upscales — storing more pixels than the source has is pure waste", () => {
    expect(backgroundImageTargetSize(800, 600, STRIP_BOX.width, STRIP_BOX.height)).toEqual({
      width: 800,
      height: 600,
    });
  });

  it("stores half the box's longest side, which is what halves decode cost per slide", () => {
    // Box longest side 7920 -> cap 3960 on the image's longest side.
    const size = backgroundImageTargetSize(15840, 4000, STRIP_BOX.width, STRIP_BOX.height);
    expect(size.width).toBe(3960);
  });

  it("preserves aspect ratio, so a background is never silently stretched", () => {
    const size = backgroundImageTargetSize(6000, 4000, STRIP_BOX.width, STRIP_BOX.height);
    expect(size.width / size.height).toBeCloseTo(6000 / 4000, 2);
  });

  it("caps the longest side at MAX_BG_IMAGE_DIM however large the box is", () => {
    // A box wide enough that the 0.5x rule alone would allow 12000px.
    const size = backgroundImageTargetSize(24000, 12000, 48000, 2868);
    expect(Math.max(size.width, size.height)).toBeLessThanOrEqual(MAX_BG_IMAGE_DIM);
  });

  it("caps total pixels, which the dimension cap alone does not do for a square", () => {
    // 4096x4096 passes MAX_BG_IMAGE_DIM but is 16.8 megapixels.
    const size = backgroundImageTargetSize(8000, 8000, 100000, 100000);
    expect(size.width * size.height).toBeLessThanOrEqual(MAX_BG_IMAGE_PIXELS);
    expect(Math.max(size.width, size.height)).toBeLessThanOrEqual(MAX_BG_IMAGE_DIM);
  });

  it("degenerates safely rather than producing a zero-area canvas", () => {
    expect(backgroundImageTargetSize(0, 0, 1320, 2868)).toEqual({ width: 0, height: 0 });
    expect(backgroundImageTargetSize(1, 1, 1320, 2868)).toEqual({ width: 1, height: 1 });
  });
});
