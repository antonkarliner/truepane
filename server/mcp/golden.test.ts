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
import { createCanvas, loadImage } from "@napi-rs/canvas";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { defaultState } from "../../src/core/constants";
import { paintSlide } from "../../src/core/render";
import type { CanvasLike, Slide } from "../../src/core/types";
import "./canvas"; // installs the @napi-rs/canvas factory into the core
import { registerDefaultFonts } from "./fonts";

const GOLDEN = path.join(path.dirname(fileURLToPath(import.meta.url)), "assets", "golden", "slide-ios.png");
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

it("Node render matches the golden reference within tolerance", async () => {
  const actual = await renderActual();

  if (process.env.TRUEPANE_UPDATE_GOLDEN) {
    fs.mkdirSync(path.dirname(GOLDEN), { recursive: true });
    fs.writeFileSync(GOLDEN, actual.toBuffer("image/png"));
    console.error(`golden reference written: ${GOLDEN}`);
    return;
  }

  expect(fs.existsSync(GOLDEN), `golden reference missing at ${GOLDEN} — run with TRUEPANE_UPDATE_GOLDEN=1`).toBe(true);
  const goldenImg = await loadImage(fs.readFileSync(GOLDEN));
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
