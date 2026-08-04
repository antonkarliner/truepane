import { normalizeComposition } from "./composition";
import { defaultState } from "./constants";
import { normalizeBackground } from "./normalize";
import type { AppState, Background, Composition, CustomFont, Settings } from "./types";

export const BRAND_KIT_VERSION = 1;
export const BRAND_KIT_STORAGE_KEY = "truepane-brand-kits-v1";
export const MAX_BRAND_KIT_BYTES = 8 * 1024 * 1024;

export interface BrandKitStyle {
  fontFamily: string;
  customFont: CustomFont | null;
  titleColor: string;
  titleScale: number;
  titleWeight: number;
  subheadColor: string;
  subtitleScale: number;
  subtitleWeight: number;
  background: Background;
  composition: Composition;
}

export interface BrandKit {
  version: 1;
  id: string;
  name: string;
  style: BrandKitStyle;
}

function clamp(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : fallback;
}

export function brandKitFromSettings(name: string, settings: Settings, id: string = crypto.randomUUID()): BrandKit {
  return {
    version: BRAND_KIT_VERSION,
    id,
    name: name.trim() || "Untitled brand",
    style: {
      fontFamily: settings.fontFamily,
      customFont: settings.customFont,
      titleColor: settings.titleColor,
      titleScale: settings.titleScale,
      titleWeight: settings.titleWeight,
      subheadColor: settings.subheadColor,
      subtitleScale: settings.subtitleScale,
      subtitleWeight: settings.subtitleWeight,
      background: normalizeBackground(settings.background),
      composition: normalizeComposition(settings.composition),
    },
  };
}

export function normalizeBrandKit(raw: unknown): BrandKit {
  if (!raw || typeof raw !== "object") throw new Error("Brand kit must be a JSON object.");
  const source = raw as Record<string, unknown>;
  if (source.version !== BRAND_KIT_VERSION) throw new Error(`Unsupported brand kit version: ${String(source.version)}.`);
  if (!source.style || typeof source.style !== "object") throw new Error("Brand kit is missing style.");
  const style = source.style as Record<string, unknown>;
  const defaults = defaultState().settings;
  const customFont = style.customFont && typeof style.customFont === "object"
    ? style.customFont as Record<string, unknown>
    : null;
  if (customFont?.dataUrl && typeof customFont.dataUrl === "string" && customFont.dataUrl.length > MAX_BRAND_KIT_BYTES) {
    throw new Error("Custom font in brand kit is too large.");
  }
  // A brand backdrop travels with the kit, which is correct — but it is the
  // largest thing a kit can carry, and the font check alone would let an
  // arbitrarily large image through the same door.
  const kitImage = (style.background as { image?: { source?: { dataUrl?: unknown } } } | undefined)?.image;
  if (typeof kitImage?.source?.dataUrl === "string" && kitImage.source.dataUrl.length > MAX_BRAND_KIT_BYTES) {
    throw new Error("Background image in brand kit is too large.");
  }
  return brandKitFromSettings(
    typeof source.name === "string" ? source.name : "Imported brand",
    {
      ...defaults,
      fontFamily: typeof style.fontFamily === "string" ? style.fontFamily : defaults.fontFamily,
      customFont: customFont && typeof customFont.name === "string" && typeof customFont.dataUrl === "string"
        ? { name: customFont.name, dataUrl: customFont.dataUrl }
        : null,
      titleColor: typeof style.titleColor === "string" ? style.titleColor : defaults.titleColor,
      titleScale: clamp(style.titleScale, defaults.titleScale, 0.3, 2),
      titleWeight: clamp(style.titleWeight, defaults.titleWeight, 100, 900),
      subheadColor: typeof style.subheadColor === "string" ? style.subheadColor : defaults.subheadColor,
      subtitleScale: clamp(style.subtitleScale, defaults.subtitleScale, 0.3, 2),
      subtitleWeight: clamp(style.subtitleWeight, defaults.subtitleWeight, 100, 900),
      background: normalizeBackground(style.background),
      composition: normalizeComposition(style.composition),
    },
    typeof source.id === "string" ? source.id : crypto.randomUUID(),
  );
}

export function applyBrandKit(state: AppState, kit: BrandKit, clearSlideOverrides = false): AppState {
  const settings: Settings = {
    ...state.settings,
    ...kit.style,
    background: normalizeBackground(kit.style.background),
    composition: normalizeComposition(kit.style.composition),
  };
  return {
    settings,
    slides: clearSlideOverrides
      ? state.slides.map((slide) => ({
          ...slide,
          background: undefined,
          composition: undefined,
          titleColor: undefined,
          subheadColor: undefined,
        }))
      : state.slides,
  };
}
