// Golden-image test for the Node rendering path — the project's only automated
// visual test. Renders one fully deterministic iOS slide (fixed seed, a
// synthetic screenshot drawn in-test, and ONLY the bundled Inter TTFs — no
// network fonts, no system fonts) and compares it against a checked-in
// reference PNG.
//
// Thresholds: a pixel "differs" when any RGBA channel deviates by more than 8
// (out of 255) from the reference; the test fails when more than 0.5% of
// pixels differ. That absorbs antialiasing/resampling drift across
// @napi-rs/canvas (Skia) versions and platforms, while a wrong color, moved
// layout, or missing shape flips far more than 0.5% of pixels.
//
// Regenerate the reference after an INTENTIONAL visual change with:
//   TRUEPANE_UPDATE_GOLDEN=1 npx vitest run server/mcp/golden.test.ts
// then eyeball the new PNG before committing it.
import { createCanvas, loadImage, type Canvas } from "@napi-rs/canvas";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { defaultState } from "../../src/core/constants";
import { paintSlide, registerBackgroundImage } from "../../src/core/render";
import type { CanvasLike, ImageSourceLike, Slide } from "../../src/core/types";
import "./canvas"; // installs the @napi-rs/canvas factory into the core
import { registerDefaultFonts } from "./fonts";

const GOLDEN_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "assets", "golden");
const GOLDEN = path.join(GOLDEN_DIR, "slide-ios.png");
const GOLDEN_BACKGROUND_IMAGE = path.join(GOLDEN_DIR, "background-image-strip.png");
const MAX_CHANNEL_DELTA = 8;
const MAX_DIFF_FRACTION = 0.005; // 0.5% of pixels

// Deterministic stand-in screenshot: flat fills + a few shapes, no text (so
// the screenshot itself has zero font dependence).
function syntheticScreenshot() {
  const c = createCanvas(930, 2000);
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#0f2d3c";
  ctx.fillRect(0, 0, 930, 2000);
  ctx.fillStyle = "#f4efe7";
  ctx.fillRect(60, 140, 810, 320);
  ctx.fillStyle = "#c2410c";
  ctx.beginPath();
  ctx.arc(465, 900, 220, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#2e8b7a";
  ctx.fillRect(60, 1400, 810, 180);
  return c;
}

async function renderActual() {
  registerDefaultFonts(); // bundled Inter only — never fetches
  const state = defaultState();
  state.settings.fontFamily = "Inter";
  state.settings.background = {
    ...state.settings.background,
    fill: "linear",
    color: "#fbe8d8",
    gradientColor: "#f5c6a0",
    gradientAngle: 160,
    shape: "bubbles",
    accent: "#c2410c",
    accentOpacity: 0.3,
    density: 3,
    seed: 7,
  };
  const slide: Slide = {
    title: "Brew Better Coffee",
    subhead: "Guided recipes for every brewer.",
    image: syntheticScreenshot() as unknown as Slide["image"],
    imageDataUrl: null,
  };
  const full = createCanvas(1, 1); // paintSlide resizes to 1320x2868
  await paintSlide(full as unknown as CanvasLike, slide, state.settings, 0, 1);
  // Compare at quarter scale (330x717): keeps the checked-in PNG small; both
  // sides of the comparison go through the identical downscale.
  const out = createCanvas(330, 717);
  out.getContext("2d").drawImage(full, 0, 0, 330, 717);
  return out;
}

async function compareToGolden(actual: Canvas, golden: string): Promise<void> {
  if (process.env.TRUEPANE_UPDATE_GOLDEN) {
    fs.mkdirSync(path.dirname(golden), { recursive: true });
    fs.writeFileSync(golden, actual.toBuffer("image/png"));
    console.error(`golden reference written: ${golden}`);
    return;
  }

  expect(fs.existsSync(golden), `golden reference missing at ${golden} — run with TRUEPANE_UPDATE_GOLDEN=1`).toBe(true);
  const goldenImg = await loadImage(fs.readFileSync(golden));
  expect({ w: goldenImg.width, h: goldenImg.height }).toEqual({ w: actual.width, h: actual.height });

  const gc = createCanvas(goldenImg.width, goldenImg.height);
  gc.getContext("2d").drawImage(goldenImg, 0, 0);
  const expected = gc.getContext("2d").getImageData(0, 0, gc.width, gc.height).data;
  const got = actual.getContext("2d").getImageData(0, 0, actual.width, actual.height).data;

  let differing = 0;
  for (let i = 0; i < expected.length; i += 4) {
    if (
      Math.abs(expected[i] - got[i]) > MAX_CHANNEL_DELTA ||
      Math.abs(expected[i + 1] - got[i + 1]) > MAX_CHANNEL_DELTA ||
      Math.abs(expected[i + 2] - got[i + 2]) > MAX_CHANNEL_DELTA ||
      Math.abs(expected[i + 3] - got[i + 3]) > MAX_CHANNEL_DELTA
    ) {
      differing++;
    }
  }
  const fraction = differing / (expected.length / 4);
  expect(
    fraction,
    `${(fraction * 100).toFixed(3)}% of pixels differ by >${MAX_CHANNEL_DELTA}/channel (limit ${MAX_DIFF_FRACTION * 100}%)`,
  ).toBeLessThanOrEqual(MAX_DIFF_FRACTION);
}

it("Node render matches the golden reference within tolerance", async () => {
  await compareToGolden(await renderActual(), GOLDEN);
});

// Deterministic stand-in backdrop, sized for a 4-slide iPhone strip
// (5280x2868, stored at half). Hard-edged bands and circles on purpose: a
// half-pixel drift in the slice offset shows up as a visible step at the seam,
// which a soft gradient would hide.
function syntheticBackdrop() {
  const w = 2640;
  const h = 1434;
  const c = createCanvas(w, h);
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#123044";
  ctx.fillRect(0, 0, w, h);
  // Band phase is offset by 27px on purpose. A 110px band pitch maps to 220px
  // in strip space, and 1320 (the slide boundary) is an exact multiple of it —
  // an unshifted edge would land precisely on the seam, where a legitimate
  // hard edge is indistinguishable from a broken one.
  const bands = ["#c2410c", "#2e8b7a", "#f4efe7", "#5b6cff"];
  for (let i = 0; i < 24; i++) {
    ctx.fillStyle = bands[i % bands.length];
    ctx.fillRect(27 + i * 110, 0, 55, h);
  }
  ctx.fillStyle = "#0f2d3c";
  for (let i = 0; i < 8; i++) {
    ctx.beginPath();
    ctx.arc(160 + i * 330, 420 + (i % 3) * 260, 150, 0, Math.PI * 2);
    ctx.fill();
  }
  return c;
}

// The seam between two exported slides is the whole feature. This renders two
// ADJACENT slides of a strip-spanned background side by side, so the reference
// PNG itself shows whether the backdrop continues across the boundary — a
// single-slide golden could not tell a continuous strip from a repeat.
it("renders a strip-spanned background image continuously across adjacent slides", async () => {
  registerDefaultFonts();
  const backdrop = syntheticBackdrop();
  const id = "golden-backdrop";
  registerBackgroundImage(id, backdrop as unknown as ImageSourceLike);

  const state = defaultState();
  state.settings.fontFamily = "Inter";
  state.settings.background = {
    ...state.settings.background,
    fill: "solid",
    color: "#101820",
    shape: "none",
    image: {
      source: { kind: "upload", id, dataUrl: "registered-in-test", width: 2640, height: 1434 },
      span: "strip",
      fit: "cover",
      opacity: 0.9,
      // A light scrim, which is what a real project uses to keep a dark title
      // readable over a busy photo — and it keeps this reference legible.
      scrim: 0.55,
      scrimColor: "#f4efe7",
      meanLuminance: 0.3,
    },
  };
  const slide: Slide = {
    title: "One Long Backdrop",
    subhead: "Flows across the whole strip.",
    image: syntheticScreenshot() as unknown as Slide["image"],
    imageDataUrl: null,
  };

  // Slides 1 and 2 of a 4-slide strip, at quarter scale, laid out adjacently.
  const out = createCanvas(330 * 2, 717);
  for (const [column, slideIndex] of [[0, 1], [1, 2]] as const) {
    const full = createCanvas(1, 1);
    await paintSlide(full as unknown as CanvasLike, slide, state.settings, slideIndex, 4);
    out.getContext("2d").drawImage(full, column * 330, 0, 330, 717);
  }
  // The reference PNG catches a change; this catches the specific failure the
  // feature exists to avoid. Sampled above the text block, where nothing but
  // the background paints.
  const seam = out.getContext("2d");
  for (const y of [4, 12, 20]) {
    const left = seam.getImageData(329, y, 1, 1).data;
    const right = seam.getImageData(330, y, 1, 1).data;
    for (let channel = 0; channel < 3; channel++) {
      expect(
        Math.abs(left[channel] - right[channel]),
        `strip backdrop breaks at the slide boundary (y=${y}, channel ${channel})`,
      ).toBeLessThanOrEqual(24);
    }
  }

  await compareToGolden(out, GOLDEN_BACKGROUND_IMAGE);
});

it("renders the Google Play feature graphic at exactly 1024x500", async () => {
  registerDefaultFonts();
  const state = defaultState();
  state.settings.platform = "android";
  state.settings.output = {
    id: "play-feature",
    label: "Google Play feature graphic",
    width: 1024,
    height: 500,
    store: "playstore",
    kind: "feature",
    frame: "android",
  };
  const slide: Slide = {
    title: "Brew Better Coffee",
    subhead: "Guided recipes for every brewer.",
    image: syntheticScreenshot() as unknown as Slide["image"],
    imageDataUrl: null,
  };
  const canvas = createCanvas(1, 1);
  await paintSlide(canvas as unknown as CanvasLike, slide, state.settings, 0, 1);
  expect({ w: canvas.width, h: canvas.height }).toEqual({ w: 1024, h: 500 });
  expect(canvas.getContext("2d").getImageData(512, 250, 1, 1).data[3]).toBeGreaterThan(0);
});
