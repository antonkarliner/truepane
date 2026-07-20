// Pure normalization for persisted/imported project state. Shared between the
// browser app (localStorage load, JSON import) and the Node MCP server, so the
// two never diverge on how a saved project is healed.
import { defaultState } from "./constants";
import type { AppState, Background, Slide, SlideText } from "./types";

// Merge a persisted/imported background onto current defaults, and migrate the
// old single `pattern` field to the new fill + shape split.
export function normalizeBackground(raw: unknown): Background {
  const base = defaultState().settings.background;
  const src = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const b = { ...base, ...src } as unknown as Background & { pattern?: string };
  if (b.pattern) {
    if (b.pattern === "linear" || b.pattern === "radial") {
      b.fill = b.pattern;
      b.shape = "none";
    } else if (b.pattern === "solid") {
      b.fill = "solid";
      b.shape = "none";
    } else {
      b.fill = "solid";
      b.shape = b.pattern as Background["shape"];
    }
    delete b.pattern;
  }
  return b;
}

// Light guard for persisted/imported per-language translations: keep the
// { title, subhead } strings and an optional per-locale imageDataUrl; drop
// anything malformed. Live `image` is never persisted, so it is not read here.
export function normalizeTranslations(raw: unknown): Record<string, SlideText> | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const out: Record<string, SlideText> = {};
  for (const [code, v] of Object.entries(raw as Record<string, unknown>)) {
    if (v && typeof v === "object") {
      const t = v as Record<string, unknown>;
      out[code] = {
        title: typeof t.title === "string" ? t.title : "",
        subhead: typeof t.subhead === "string" ? t.subhead : "",
        imageDataUrl: typeof t.imageDataUrl === "string" ? t.imageDataUrl : null,
      };
    }
  }
  return Object.keys(out).length ? out : undefined;
}

// Serialize translations for persistence/export: keep title/subhead and only a
// non-empty imageDataUrl; drop the live `image` (not JSON-serializable) so a
// locale without its own screenshot stays the compact { title, subhead } shape.
export function serializeTranslations(
  translations: Record<string, SlideText> | undefined,
): Record<string, SlideText> | undefined {
  if (!translations) return undefined;
  const out: Record<string, SlideText> = {};
  for (const [code, t] of Object.entries(translations)) {
    out[code] = t.imageDataUrl
      ? { title: t.title, subhead: t.subhead, imageDataUrl: t.imageDataUrl }
      : { title: t.title, subhead: t.subhead };
  }
  return out;
}

// Build a healed AppState from a parsed project JSON (localStorage payload or
// an exported project file — same shape). Images are NOT hydrated here; slides
// come back with `image: null` and only `imageDataUrl` set.
export function normalizeAppState(parsed: unknown): AppState {
  const p = (parsed && typeof parsed === "object" ? parsed : {}) as {
    settings?: Record<string, unknown>;
    slides?: Partial<Slide>[];
  };
  const s = defaultState();
  if (p.settings) Object.assign(s.settings, p.settings);
  s.settings.background = normalizeBackground(p.settings?.background);
  if (p.slides) {
    s.slides = p.slides.map((sl) => ({
      title: sl.title || "",
      subhead: sl.subhead || "",
      image: null,
      imageDataUrl: sl.imageDataUrl || null,
      background: sl.background ? normalizeBackground(sl.background) : undefined,
      translations: normalizeTranslations(sl.translations),
    }));
  }
  return s;
}
