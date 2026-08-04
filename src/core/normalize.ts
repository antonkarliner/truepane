// Pure normalization for persisted/imported project state. Shared between the
// browser app (localStorage load, JSON import) and the Node MCP server, so the
// two never diverge on how a saved project is healed.
import { DEFAULT_CUSTOM_SHAPE, defaultState } from "./constants";
import { normalizeComposition } from "./composition";
import { normalizeOutput } from "./output";
import type {
  AppState,
  Background,
  BackgroundImage,
  CustomShapeLayout,
  CustomShapePrimitive,
  CustomShapeSpec,
  ReleaseBaseline,
  Slide,
  SlideText,
  TargetMedia,
} from "./types";

// Merge a persisted/imported background onto current defaults, and migrate the
// old single `pattern` field to the new fill + shape split.
const clamp01 = (value: unknown, fallback: number): number =>
  typeof value === "number" && Number.isFinite(value)
    ? Math.min(1, Math.max(0, value))
    : fallback;

const CUSTOM_SHAPE_PRIMITIVES: CustomShapePrimitive[] = ["ring", "disc", "arc", "triangle", "bar", "blob"];
const CUSTOM_SHAPE_LAYOUTS: CustomShapeLayout[] = ["scatter", "grid", "row", "radial", "wave"];

const clampNum = (value: unknown, lo: number, hi: number, fallback: number): number =>
  typeof value === "number" && Number.isFinite(value) ? Math.min(hi, Math.max(lo, value)) : fallback;

/**
 * Heal a custom shape spec: clamp every field into its documented range and
 * coerce unknown enum strings back to the default.
 *
 * Agents will send junk. Every field is clamped rather than rejected so a
 * sloppy call still renders something instead of failing the whole patch, and
 * `count` — the one field that bounds an allocation — is clamped here before
 * any generator reads it. `spacingX`/`spacingY` have a hard non-zero floor for
 * the same reason: a zero lattice step is a degenerate layout.
 *
 * Also called from render.ts, so a spec that reaches the painter without going
 * through project normalization (a hand-built MCP call, a legacy import) is
 * bounded on the way in too.
 */
export function clampCustomShape(raw: unknown): CustomShapeSpec {
  const src = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const d = DEFAULT_CUSTOM_SHAPE;
  return {
    primitive: CUSTOM_SHAPE_PRIMITIVES.includes(src.primitive as CustomShapePrimitive)
      ? (src.primitive as CustomShapePrimitive)
      : d.primitive,
    layout: CUSTOM_SHAPE_LAYOUTS.includes(src.layout as CustomShapeLayout)
      ? (src.layout as CustomShapeLayout)
      : d.layout,
    count: Math.round(clampNum(src.count, 1, 200, d.count)),
    size: clampNum(src.size, 0, 1, d.size),
    sizeJitter: clampNum(src.sizeJitter, 0, 1, d.sizeJitter),
    rotation: clampNum(src.rotation, -180, 180, d.rotation),
    rotationJitter: clampNum(src.rotationJitter, 0, 360, d.rotationJitter),
    spacingX: clampNum(src.spacingX, 0.02, 2, d.spacingX),
    spacingY: clampNum(src.spacingY, 0.02, 2, d.spacingY),
    phase: clampNum(src.phase, 0, 1, d.phase),
    strokeWidth: clampNum(src.strokeWidth, 0, 40, d.strokeWidth),
    opacityRamp: clampNum(src.opacityRamp, -1, 1, d.opacityRamp),
  };
}

// Heal a background image from persisted or MCP input. Anything malformed is
// dropped entirely rather than half-applied: a background that references
// bytes it cannot describe is worse than no background at all.
function normalizeBackgroundImage(raw: unknown): BackgroundImage | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const src = raw as Record<string, unknown>;
  const sourceRaw = src.source as Record<string, unknown> | undefined;
  if (!sourceRaw || typeof sourceRaw !== "object") return undefined;

  let source: BackgroundImage["source"];
  if (sourceRaw.kind === "screenshot") {
    source = { kind: "screenshot", blur: clamp01(sourceRaw.blur, 0.5) };
  } else if (
    typeof sourceRaw.id === "string" &&
    typeof sourceRaw.dataUrl === "string" &&
    sourceRaw.dataUrl
  ) {
    source = {
      kind: "upload",
      id: sourceRaw.id,
      dataUrl: sourceRaw.dataUrl,
      width: typeof sourceRaw.width === "number" ? sourceRaw.width : 0,
      height: typeof sourceRaw.height === "number" ? sourceRaw.height : 0,
    };
  } else {
    return undefined;
  }

  // A screenshot-derived background is inherently per-slide and always fills:
  // clamp rather than trust, so a stray span never slices one slide's own
  // screenshot across the strip.
  const derived = source.kind === "screenshot";
  return {
    source,
    span: !derived && src.span === "strip" ? "strip" : "slide",
    fit: !derived && src.fit === "contain" ? "contain" : "cover",
    // Screenshot-derived projects stored blur on the source. Migrate that
    // value to the image layer so the same control now works for uploads too.
    blur: clamp01(src.blur, source.kind === "screenshot" ? source.blur : 0),
    opacity: clamp01(src.opacity, 1),
    scrim: clamp01(src.scrim, 0),
    scrimColor: typeof src.scrimColor === "string" ? src.scrimColor : "#000000",
    meanLuminance: clamp01(src.meanLuminance, 0.5),
  };
}

export function normalizeBackground(raw: unknown): Background {
  const base = defaultState().settings.background;
  const src = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const b = { ...base, ...src } as unknown as Background & { pattern?: string };
  // Absent stays absent, so projects without an image serialize as they did
  // before this feature existed.
  const image = normalizeBackgroundImage((src as { image?: unknown }).image);
  if (image) b.image = image;
  else delete b.image;
  // Same absent-stays-absent rule: a project that never used the custom family
  // serializes byte-for-byte as it did before the family existed.
  const rawCustom = (src as { customShape?: unknown }).customShape;
  if (rawCustom && typeof rawCustom === "object") b.customShape = clampCustomShape(rawCustom);
  else delete b.customShape;
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
