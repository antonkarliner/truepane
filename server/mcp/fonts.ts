// Font registration for Node rendering with @napi-rs/canvas.
//
// Strategy (per plan §4): cache-on-demand. Each FONT_OPTIONS entry with a
// `google` css2 family spec is resolved by fetching the Google Fonts css2 API
// with a legacy (empty) User-Agent — which returns static per-weight TTF
// URLs — downloading those into ~/.cache/truepane/fonts/, and registering
// them under the exact family name the core puts in ctx.font (the option
// `id`, e.g. "Inter"). System-font entries (no `google` field) can't be
// fetched; the bundled Inter TTFs are registered under those ids as an alias
// so text still renders. Failures warn on stderr and fall back — never crash.
import { GlobalFonts } from "@napi-rs/canvas";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { FONT_OPTIONS } from "../../src/core/constants";
import type { AppState } from "../../src/core/types";

const CACHE_DIR = path.join(os.homedir(), ".cache", "truepane", "fonts");
const ASSETS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "assets", "fonts");

// Families with some usable face registered in this process.
const registered = new Set<string>();
// Families whose full variable font has been loaded (supersedes static faces).
const variableLoaded = new Set<string>();

function warn(msg: string): void {
  console.error(`[truepane-mcp] ${msg}`);
}

/** Register the bundled Inter TTFs under `family`. Used for the app default
 * ("Inter") and as the stand-in for unfetchable system fonts. */
function registerBundled(family: string): void {
  if (registered.has(family)) return;
  let any = false;
  for (const f of ["Inter-400.ttf", "Inter-500.ttf", "Inter-700.ttf"]) {
    const p = path.join(ASSETS_DIR, f);
    if (fs.existsSync(p) && GlobalFonts.registerFromPath(p, family)) any = true;
  }
  if (any) registered.add(family);
  else warn(`bundled fallback font missing for "${family}" (looked in ${ASSETS_DIR})`);
}

/** Startup registration: the app's default font plus the placeholder font
 * ("Inter" — see defaultState() and the screenshot placeholder in render.ts),
 * so offline first-run still renders text. */
export function registerDefaultFonts(): void {
  registerBundled("Inter");
}

// System-font families (no `google` spec) that can be satisfied from the OS's
// own installed fonts. We register from these existing paths only — Apple's San
// Francisco is proprietary and must never be bundled/redistributed, so this
// gives real SF on a licensed macOS box and falls back to bundled Inter
// elsewhere (Linux/CI), mirroring how a browser resolves `-apple-system`.
const SYSTEM_FONT_PATHS: Record<string, string[]> = {
  "-apple-system": [
    "/System/Library/Fonts/SFNS.ttf", // San Francisco (macOS 11+ variable UI font)
    "/System/Library/Fonts/SFNSDisplay.ttf", // pre-Big Sur
    "/System/Library/Fonts/SFNSText.ttf",
  ],
};

/** Register a no-fetch system font from the OS's own installed copy if present,
 * else alias bundled Inter. Never downloads or bundles the system font. */
function registerSystemFont(family: string): void {
  if (registered.has(family)) return;
  for (const p of SYSTEM_FONT_PATHS[family] ?? []) {
    if (fs.existsSync(p) && GlobalFonts.registerFromPath(p, family)) {
      registered.add(family);
      return;
    }
  }
  registerBundled(family);
}

// A curated set of popular headline fonts whose FULL weight range (Heavy/Black)
// is worth resolving. Google's css2 API only serves variable fonts as many
// unicode-range-subsetted woff2 files, which @napi-rs/canvas can't coverage-
// match across subsets — so for these we fetch the single, unsubsetted variable
// TTF from Google's font repo instead. That one file registers cleanly with
// full glyph coverage AND a working wght axis (driven by applyWeightAxis in
// render.ts). Everything else stays on the static path below (weights ≤ 700).
// Want another font here? Open an issue or PR — see the README.
const VARIABLE_FONT_URLS: Record<string, string> = {
  Inter: "https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/inter/Inter%5Bopsz,wght%5D.ttf",
  Manrope: "https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/manrope/Manrope%5Bwght%5D.ttf",
  Fraunces: "https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/fraunces/Fraunces%5BSOFT,WONK,opsz,wght%5D.ttf",
};

// Download (once) and register the single-file variable font for `family`.
async function registerVariableFont(family: string, url: string): Promise<boolean> {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const file = path.join(CACHE_DIR, `${family.replace(/\s+/g, "-")}-var.ttf`);
  if (!(fs.existsSync(file) && fs.statSync(file).size > 0)) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`variable font HTTP ${res.status} for ${url}`);
    fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  }
  return GlobalFonts.registerFromPath(file, family) != null;
}

// Resolve a css2 family spec to TTF URLs. An empty User-Agent makes Google
// serve static truetype files (one @font-face per weight) instead of woff2.
async function fetchTtfUrls(googleSpec: string): Promise<string[]> {
  const url = `https://fonts.googleapis.com/css2?family=${googleSpec}&display=swap`;
  const res = await fetch(url, { headers: { "User-Agent": "" } });
  if (!res.ok) throw new Error(`css2 fetch failed: HTTP ${res.status}`);
  const css = await res.text();
  const urls = [...css.matchAll(/url\((https:\/\/fonts\.gstatic\.com\/[^)]+\.ttf)\)/g)].map(
    (m) => m[1],
  );
  return [...new Set(urls)];
}

async function downloadToCache(url: string): Promise<string> {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const file = path.join(CACHE_DIR, path.basename(new URL(url).pathname));
  if (fs.existsSync(file) && fs.statSync(file).size > 0) return file;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`font download failed: HTTP ${res.status} for ${url}`);
  fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  return file;
}

/** Ensure `family` (a FONT_OPTIONS id) is registered, downloading and caching
 * as needed. Prefers the single-file variable font (full weight range) for the
 * curated set, then the static per-weight faces, then bundled Inter. */
export async function ensureFamily(family: string): Promise<void> {
  const opt = FONT_OPTIONS.find((f) => f.id === family);
  const varUrl = opt?.google ? VARIABLE_FONT_URLS[family] : undefined;

  // Upgrade the curated set to their full variable font (once) — even if a
  // bundled/static face is already registered (e.g. Inter at startup), because
  // the variable font is what unlocks the whole weight range.
  if (varUrl && !variableLoaded.has(family)) {
    try {
      if (await registerVariableFont(family, varUrl)) {
        registered.add(family);
        variableLoaded.add(family);
        return;
      }
    } catch (e) {
      warn(`variable font for "${family}" failed (${e}) — falling back to static faces`);
    }
  }

  if (registered.has(family)) return;

  if (!opt) {
    warn(`unknown font family "${family}" — rendering with bundled Inter under that name`);
    registerBundled(family);
    return;
  }
  if (!opt.google) {
    // System font (e.g. -apple-system): register the OS's own installed copy
    // if present (real San Francisco on macOS), else alias bundled Inter.
    registerSystemFont(family);
    return;
  }
  try {
    const urls = await fetchTtfUrls(opt.google);
    if (urls.length === 0) throw new Error("no TTF urls in css2 response");
    let any = false;
    for (const u of urls) {
      const p = await downloadToCache(u);
      if (GlobalFonts.registerFromPath(p, family)) any = true;
    }
    if (!any) throw new Error("GlobalFonts.registerFromPath rejected all files");
    registered.add(family);
  } catch (e) {
    warn(`could not load Google font "${family}" (${e}) — falling back to bundled Inter`);
    registerBundled(family);
  }
}

/** Register a custom font supplied as a data URL (settings.customFont). */
export function registerCustomFont(name: string, dataUrl: string): void {
  if (registered.has(name)) return;
  try {
    const m = /^data:[^;]+;base64,(.*)$/.exec(dataUrl);
    if (!m) throw new Error("customFont dataUrl is not base64");
    const buf = Buffer.from(m[1], "base64");
    if (!GlobalFonts.register(buf, name)) throw new Error("GlobalFonts.register returned false");
    registered.add(name);
  } catch (e) {
    warn(`could not register custom font "${name}" (${e}) — falling back to bundled Inter`);
    registerBundled(name);
  }
}

/** Make sure every font the project renders with is available. */
export async function ensureFontsForState(state: AppState): Promise<void> {
  const cf = state.settings.customFont;
  if (cf && state.settings.fontFamily === cf.name) {
    registerCustomFont(cf.name, cf.dataUrl);
    return;
  }
  await ensureFamily(state.settings.fontFamily || "Inter");
}
