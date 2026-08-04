// Background-image import: downscale, re-encode, measure.
//
// Runtime-agnostic on purpose — the browser drop zone and the MCP
// `set_background_image` tool run the identical pipeline, so an agent cannot
// write a payload a human could not have produced.
//
// The downscale is about render cost and memory, not storage: Plan 011 moved
// binaries into an IndexedDB asset store, so `MAX_BG_IMAGE_BYTES` is a size
// hint the caller surfaces, never a rejection.
import { assetId, dataUrlToBlob } from "./content-id";
import { createSurface } from "./render";
import type { BackgroundImage, CanvasLike, ImageSourceLike } from "./types";

/** Hard ceiling on either stored dimension, whatever the destination box. */
export const MAX_BG_IMAGE_DIM = 4096;
/** Hard ceiling on stored pixel count — caps decode memory on wide strips. */
export const MAX_BG_IMAGE_PIXELS = 8_000_000;
/** Above this the caller shows a size hint. Not a rejection. */
export const MAX_BG_IMAGE_BYTES = 2 * 1024 * 1024;

/** Backgrounds never need alpha, and JPEG is where the megabytes go away. */
const JPEG_QUALITY = 0.82;
/** Side of the square used to average luminance. A downscale is a box filter,
 * so the mean over 64x64 is the mean over the whole image to within noise. */
const LUMINANCE_SAMPLE = 64;

export type UploadedBackgroundSource = Extract<BackgroundImage["source"], { kind: "upload" }>;

export interface PreparedBackgroundImage {
  source: UploadedBackgroundSource;
  meanLuminance: number;
  /** Encoded size of the stored JPEG. */
  bytes: number;
  /** Human-readable size hint when `bytes` exceeds MAX_BG_IMAGE_BYTES. */
  warning: string | null;
}

/**
 * Stored size for a source image against a destination box.
 *
 * Half the box's longest side is deliberate: a background is low-frequency and
 * usually sits under a scrim, so the 2x upscale at paint time is invisible
 * while the decode cost and memory halve on every render — and a strip render
 * decodes the same image once per slide.
 *
 * Never upscales: an image smaller than the cap is stored as-is.
 */
export function backgroundImageTargetSize(
  imageWidth: number,
  imageHeight: number,
  boxWidth: number,
  boxHeight: number,
): { width: number; height: number } {
  if (imageWidth <= 0 || imageHeight <= 0) return { width: 0, height: 0 };
  const longest = Math.max(imageWidth, imageHeight);
  const scale = Math.min(
    1,
    (Math.max(boxWidth, boxHeight) * 0.5) / longest,
    MAX_BG_IMAGE_DIM / longest,
    Math.sqrt(MAX_BG_IMAGE_PIXELS / (imageWidth * imageHeight)),
  );
  return {
    width: Math.max(1, Math.round(imageWidth * scale)),
    height: Math.max(1, Math.round(imageHeight * scale)),
  };
}

function get2d(canvas: CanvasLike): CanvasRenderingContext2D {
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D canvas context unavailable");
  return ctx;
}

/** WCAG relative luminance, matching the `luminance` helper in preflight.ts —
 * the two must agree or the contrast estimate is measuring nothing. */
function channelLuminance(value: number): number {
  const channel = value / 255;
  return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

function meanLuminanceOf(image: ImageSourceLike): number {
  const canvas = createSurface(LUMINANCE_SAMPLE, LUMINANCE_SAMPLE);
  const ctx = get2d(canvas);
  ctx.drawImage(image as unknown as CanvasImageSource, 0, 0, LUMINANCE_SAMPLE, LUMINANCE_SAMPLE);
  const { data } = ctx.getImageData(0, 0, LUMINANCE_SAMPLE, LUMINANCE_SAMPLE);
  let total = 0;
  for (let i = 0; i < data.length; i += 4) {
    total +=
      0.2126 * channelLuminance(data[i]) +
      0.7152 * channelLuminance(data[i + 1]) +
      0.0722 * channelLuminance(data[i + 2]);
  }
  return Math.min(1, Math.max(0, total / (data.length / 4)));
}

function describeBytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Downscales and re-encodes a decoded image into a stored background source.
 *
 * `targetBox` should be the largest destination the image could be painted
 * into — the whole strip (slide width x slide count) rather than one slide —
 * so switching span later never needs a re-import.
 */
export async function prepareBackgroundImage(
  image: ImageSourceLike,
  targetBox: { width: number; height: number },
): Promise<PreparedBackgroundImage> {
  const sourceWidth = image.naturalWidth || image.width;
  const sourceHeight = image.naturalHeight || image.height;
  if (!sourceWidth || !sourceHeight) throw new Error("Background image has no pixels.");

  const { width, height } = backgroundImageTargetSize(
    sourceWidth,
    sourceHeight,
    targetBox.width,
    targetBox.height,
  );
  const canvas = createSurface(width, height);
  const ctx = get2d(canvas);
  // JPEG has no alpha channel; without an opaque base a transparent PNG
  // encodes its transparent regions as black.
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(image as unknown as CanvasImageSource, 0, 0, width, height);

  const dataUrl = canvas.toDataURL?.("image/jpeg", JPEG_QUALITY);
  if (!dataUrl?.startsWith("data:image/jpeg")) {
    throw new Error("This runtime cannot re-encode background images to JPEG.");
  }
  const blob = dataUrlToBlob(dataUrl);
  const bytes = blob.size;

  return {
    source: { kind: "upload", id: await assetId(blob), dataUrl, width, height },
    meanLuminance: meanLuminanceOf(canvas as unknown as ImageSourceLike),
    bytes,
    warning:
      bytes > MAX_BG_IMAGE_BYTES
        ? `Background image is ${describeBytes(bytes)} after downscaling (over the ${describeBytes(MAX_BG_IMAGE_BYTES)} comfort limit). It will work, but exports and saves will be slower.`
        : null,
  };
}

/** A ready-to-store image layer around a prepared upload, using the plan's
 * defaults so every caller starts from the same visible result. */
export function backgroundImageFromUpload(
  prepared: PreparedBackgroundImage,
  span: BackgroundImage["span"] = "slide",
): BackgroundImage {
  return {
    source: prepared.source,
    span,
    fit: "cover",
    blur: 0,
    opacity: 1,
    scrim: 0,
    scrimColor: "#000000",
    meanLuminance: prepared.meanLuminance,
  };
}
