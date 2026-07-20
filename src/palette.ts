// Browser entry for palette extraction: downscales a screenshot on a DOM
// canvas and hands the pixels to the shared math in src/core/palette.ts.
// Pure client-side — no AI, no cost.

import { PALETTE_SAMPLE, paletteFromPixels, type Palette } from "./core/palette";
import type { ImageSourceLike } from "./core/types";

export { accentSuggestions, type Palette } from "./core/palette";

export function extractPalette(img: ImageSourceLike): Palette | null {
  const n = PALETTE_SAMPLE;
  const c = document.createElement("canvas");
  c.width = n;
  c.height = n;
  const ctx = c.getContext("2d");
  if (!ctx) return null;
  // Slide.image is structurally typed (ImageSourceLike); at runtime it is
  // always a real drawImage-able source (HTMLImageElement in the browser).
  ctx.drawImage(img as unknown as CanvasImageSource, 0, 0, n, n);

  let data: Uint8ClampedArray;
  try {
    data = ctx.getImageData(0, 0, n, n).data;
  } catch {
    return null; // tainted canvas (cross-origin) — bail rather than throw
  }
  return paletteFromPixels(data);
}
