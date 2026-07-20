// Pure palette math, shared by the browser (src/palette.ts) and the Node MCP
// server. No DOM: callers downscale the screenshot to PALETTE_SAMPLE x
// PALETTE_SAMPLE with whatever canvas they have and hand the RGBA pixels here.

export function toHex(r: number, g: number, b: number): string {
  return "#" + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
}

function saturation(r: number, g: number, b: number): number {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  return max === 0 ? 0 : (max - min) / max;
}

export interface Palette {
  color: string;
  accent: string;
}

/** Side length of the downscaled sample both runtimes feed to paletteFromPixels. */
export const PALETTE_SAMPLE = 24;

/** Extract { accent, tint } from RGBA pixel data (as from getImageData().data).
 * Buckets pixels by coarse RGB and picks a vivid dominant color as the accent
 * plus a soft near-white tint of it as the background color. */
export function paletteFromPixels(data: Uint8ClampedArray): Palette | null {
  const buckets = new Map<string, { count: number; r: number; g: number; b: number }>();
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const a = data[i + 3];
    if (a < 128) continue;
    const key = `${r >> 5},${g >> 5},${b >> 5}`;
    const cur = buckets.get(key) ?? { count: 0, r: 0, g: 0, b: 0 };
    cur.count++;
    cur.r += r;
    cur.g += g;
    cur.b += b;
    buckets.set(key, cur);
  }
  if (buckets.size === 0) return null;

  // Accent = the most common *colorful* bucket. Without the saturation gate the
  // result is almost always near-white/gray (most UIs are mostly white), which
  // is useless as an accent — so skip near-gray buckets entirely and pick by
  // raw frequency among what's left. Fall back to the most colorful bucket if
  // the image is essentially grayscale.
  const MIN_SAT = 0.18;
  let best: { r: number; g: number; b: number } | null = null;
  let bestCount = -1;
  let fallback: { r: number; g: number; b: number } | null = null;
  let fallbackSat = -1;
  for (const v of buckets.values()) {
    const r = v.r / v.count;
    const g = v.g / v.count;
    const b = v.b / v.count;
    const sat = saturation(r, g, b);
    if (sat > fallbackSat) {
      fallbackSat = sat;
      fallback = { r, g, b };
    }
    if (sat >= MIN_SAT && v.count > bestCount) {
      bestCount = v.count;
      best = { r, g, b };
    }
  }
  const pick = best ?? fallback;
  if (!pick) return null;

  const accent = toHex(pick.r, pick.g, pick.b);
  // Background = the accent softened heavily toward white for a calm tint.
  const mix = (v: number) => v * 0.1 + 255 * 0.9;
  const color = toHex(mix(pick.r), mix(pick.g), mix(pick.b));
  return { color, accent };
}

// ---------------------------------------------------------------------------
// Harmonized accent: given a background hex, produce a same-hue shape color
// that clearly contrasts it (darker + more saturated on light backgrounds,
// lighter on dark ones). Used by the "auto-adjust shape color" option.
// ---------------------------------------------------------------------------
const HEX6 = /^#[0-9a-fA-F]{6}$/;

const DEFAULT_ACCENTS = ["#c47c3b", "#1a1612", "#5b6647", "#c4523b", "#5b6cff", "#8a6f4f"];

function hexToRgb(hex: string): [number, number, number] {
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  const d = max - min;
  if (d !== 0) {
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
  }
  return [h, s, l];
}

function hue2rgb(p: number, q: number, t: number): number {
  if (t < 0) t += 1;
  if (t > 1) t -= 1;
  if (t < 1 / 6) return p + (q - p) * 6 * t;
  if (t < 1 / 2) return q;
  if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
  return p;
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) return [l * 255, l * 255, l * 255];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [hue2rgb(p, q, h + 1 / 3) * 255, hue2rgb(p, q, h) * 255, hue2rgb(p, q, h - 1 / 3) * 255];
}

function relLuminance(r: number, g: number, b: number): number {
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}
function contrastRatio(a: number, b: number): number {
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

// A set of shape-color swatches harmonized to the background across a few
// related hues (base, analogous, complementary, triadic). Each swatch is
// pushed in lightness until it meets a minimum contrast against the
// background, so suggestions always read clearly — including on bold,
// mid-tone backgrounds where same-lightness pastels would wash out.
export function accentSuggestions(bgHex: string): string[] {
  if (!HEX6.test(bgHex)) return DEFAULT_ACCENTS;
  const [br, bgc, bb] = hexToRgb(bgHex);
  const [h, s] = rgbToHsl(br, bgc, bb);
  const bgLum = relLuminance(br, bgc, bb);
  // Only genuinely dark backgrounds get light shapes; light AND vivid mid-tone
  // backgrounds (bright red, etc.) get dark, saturated shapes that pop.
  const wantLight = bgLum < 0.22;
  const as = Math.min(0.72, Math.max(0.5, s * 0.6 + 0.32));
  const baseL = wantLight ? 0.72 : 0.36;
  const MIN_CONTRAST = 2.2;
  const offsets = [0, 30, -30, 180, 150, -150];
  return offsets.map((deg) => {
    const hh = (((h + deg / 360) % 1) + 1) % 1;
    let L = baseL;
    let [R, G, B] = hslToRgb(hh, as, L);
    for (let i = 0; i < 12 && contrastRatio(relLuminance(R, G, B), bgLum) < MIN_CONTRAST; i++) {
      L = wantLight ? Math.min(0.94, L + 0.05) : Math.max(0.08, L - 0.05);
      [R, G, B] = hslToRgb(hh, as, L);
    }
    return toHex(R, G, B);
  });
}
