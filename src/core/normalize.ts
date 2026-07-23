// Pure normalization for persisted/imported project state. Shared between the
// browser app (localStorage load, JSON import) and the Node MCP server, so the
// two never diverge on how a saved project is healed.
import { defaultState } from "./constants";
import { normalizeComposition } from "./composition";
import { normalizeOutput } from "./output";
import type { AppState, Background, ReleaseBaseline, Slide, SlideText, TargetMedia } from "./types";

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
    out[code] = { title: t.title, subhead: t.subhead };
  }
  return out;
}

function normalizeMedia(raw: unknown): Record<string, TargetMedia> | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const out: Record<string, TargetMedia> = {};
  for (const [target, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!value || typeof value !== "object") continue;
    const item = value as Record<string, unknown>;
    const sourceRaw = item.source as Record<string, unknown> | undefined;
    const sourceUrl = typeof sourceRaw?.imageDataUrl === "string" ? sourceRaw.imageDataUrl : null;
    const locales: NonNullable<TargetMedia["locales"]> = {};
    if (item.locales && typeof item.locales === "object") {
      for (const [code, locale] of Object.entries(item.locales as Record<string, unknown>)) {
        const localeUrl =
          locale && typeof locale === "object" && typeof (locale as Record<string, unknown>).imageDataUrl === "string"
            ? ((locale as Record<string, unknown>).imageDataUrl as string)
            : null;
        if (localeUrl) locales[code] = {
          image: null,
          imageDataUrl: localeUrl,
          width: typeof (locale as Record<string, unknown>).width === "number"
            ? (locale as Record<string, unknown>).width as number
            : undefined,
          height: typeof (locale as Record<string, unknown>).height === "number"
            ? (locale as Record<string, unknown>).height as number
            : undefined,
        };
      }
    }
    if (sourceUrl || Object.keys(locales).length) {
      out[target] = {
        ...(sourceUrl ? { source: {
          image: null,
          imageDataUrl: sourceUrl,
          width: typeof sourceRaw?.width === "number" ? sourceRaw.width : undefined,
          height: typeof sourceRaw?.height === "number" ? sourceRaw.height : undefined,
        } } : {}),
        ...(Object.keys(locales).length ? { locales } : {}),
      };
    }
  }
  return Object.keys(out).length ? out : undefined;
}

// Build a healed AppState from a parsed project JSON (localStorage payload or
// an exported project file — same shape). Images are NOT hydrated here; slides
// come back with `image: null` and only `imageDataUrl` set.
export function normalizeAppState(parsed: unknown): AppState {
  const p = (parsed && typeof parsed === "object" ? parsed : {}) as {
    settings?: Record<string, unknown>;
    slides?: Partial<Slide>[];
    releaseBaseline?: Partial<ReleaseBaseline>;
  };
  const s = defaultState();
  if (p.settings) Object.assign(s.settings, p.settings);
  s.settings.platform =
    typeof p.settings?.platform === "string" ? p.settings.platform : s.settings.platform;
  const rawTargets = Array.isArray(p.settings?.targets)
    ? p.settings.targets.filter((target): target is string => typeof target === "string")
    : [];
  s.settings.targets = Array.from(new Set([s.settings.platform, ...rawTargets]));
  s.settings.background = normalizeBackground(p.settings?.background);
  s.settings.composition = normalizeComposition(p.settings?.composition);
  s.settings.output = normalizeOutput(p.settings?.output, s.settings.platform);
  if (p.slides) {
    s.slides = p.slides.map((sl) => {
      const translations = normalizeTranslations(sl.translations);
      const media = normalizeMedia(sl.media);
      const migrated: Record<string, TargetMedia> = { ...(media ?? {}) };
      const legacySource = typeof sl.imageDataUrl === "string" ? sl.imageDataUrl : null;
      const legacyLocales = Object.fromEntries(
        Object.entries(translations ?? {})
          .filter(([, t]) => !!t.imageDataUrl)
          .map(([code, t]) => [code, { image: null, imageDataUrl: t.imageDataUrl ?? null }]),
      );
      if (legacySource || Object.keys(legacyLocales).length) {
        const current = migrated[s.settings.platform] ?? {};
        migrated[s.settings.platform] = {
          ...current,
          ...(current.source || !legacySource
            ? {}
            : { source: { image: null, imageDataUrl: legacySource } }),
          locales: { ...legacyLocales, ...current.locales },
        };
      }
      return {
        title: sl.title || "",
        subhead: sl.subhead || "",
        image: null,
        imageDataUrl: null,
        media: Object.keys(migrated).length ? migrated : undefined,
        background: sl.background ? normalizeBackground(sl.background) : undefined,
        composition: sl.composition ? normalizeComposition(sl.composition) : undefined,
        deviceSpan:
          sl.deviceSpan &&
          typeof sl.deviceSpan.id === "string" &&
          (sl.deviceSpan.role === "left" || sl.deviceSpan.role === "right")
            ? sl.deviceSpan
            : undefined,
        translations,
      };
    });
  }
  if (
    p.releaseBaseline?.version === 1 &&
    p.releaseBaseline.signatures &&
    typeof p.releaseBaseline.signatures === "object"
  ) {
    s.releaseBaseline = {
      version: 1,
      rendererVersion: typeof p.releaseBaseline.rendererVersion === "number"
        ? p.releaseBaseline.rendererVersion
        : 1,
      createdAt: typeof p.releaseBaseline.createdAt === "string" ? p.releaseBaseline.createdAt : "",
      signatures: Object.fromEntries(
        Object.entries(p.releaseBaseline.signatures).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
      ),
    };
  }
  return s;
}
