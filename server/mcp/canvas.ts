// Node canvas adapter: plugs @napi-rs/canvas into the runtime-agnostic core.
// Import this module for its side effect before any core rendering call.
import { createCanvas, loadImage, Canvas, Image } from "@napi-rs/canvas";
import { PALETTE_SAMPLE, paletteFromPixels, type Palette } from "../../src/core/palette";
import { setCanvasFactory } from "../../src/core/render";
import type { CanvasLike, ImageSourceLike } from "../../src/core/types";

setCanvasFactory((w, h) => createCanvas(w, h) as unknown as CanvasLike);

/** Create a canvas usable both by the core (CanvasLike) and for PNG encoding. */
export function makeCanvas(w: number, h: number): Canvas {
  return createCanvas(w, h);
}

export function pngBuffer(canvas: Canvas): Buffer {
  return canvas.toBuffer("image/png");
}

/** Node counterpart of src/palette.ts's extractPalette: downscale the image
 * on a napi canvas and run the shared quantization math from the core. */
export function paletteOfImage(img: ImageSourceLike): Palette | null {
  const n = PALETTE_SAMPLE;
  const c = createCanvas(n, n);
  const ctx = c.getContext("2d");
  ctx.drawImage(img as unknown as Image, 0, 0, n, n);
  return paletteFromPixels(ctx.getImageData(0, 0, n, n).data);
}

/** Load an image from a file path or data URL. Returns null on failure. */
export async function tryLoadImage(src: string | Buffer): Promise<Image | null> {
  try {
    return await loadImage(src);
  } catch (e) {
    console.error(`[truepane-mcp] failed to load image: ${e}`);
    return null;
  }
}
