import type { OutputSpec, Settings, StoreId } from "./types";

export const OUTPUT_MIN_DIMENSION = 320;
export const OUTPUT_MAX_DIMENSION = 8192;
export const OUTPUT_MAX_PIXELS = 40_000_000;

export const BUILTIN_OUTPUTS: OutputSpec[] = [
  { id: "ios", label: "iPhone 6.9″ screenshot", width: 1320, height: 2868, store: "appstore", kind: "native", frame: "ios" },
  { id: "ipad", label: "iPad 13″ screenshot", width: 2064, height: 2752, store: "appstore", kind: "native", frame: "ipad" },
  { id: "android", label: "Google Play phone screenshot", width: 1080, height: 2400, store: "playstore", kind: "native", frame: "android" },
  { id: "android-tablet", label: "Google Play tablet screenshot", width: 1600, height: 2560, store: "playstore", kind: "native", frame: "android-tablet" },
  { id: "play-feature", label: "Google Play feature graphic", width: 1024, height: 500, store: "playstore", kind: "feature", frame: "android" },
];

function clampDimension(value: unknown, fallback: number): number {
  const numeric = typeof value === "number" && Number.isFinite(value) ? Math.round(value) : fallback;
  return Math.min(OUTPUT_MAX_DIMENSION, Math.max(OUTPUT_MIN_DIMENSION, numeric));
}

export function safeOutputDimensions(width: unknown, height: unknown): { width: number; height: number } {
  let safeWidth = clampDimension(width, 1080);
  let safeHeight = clampDimension(height, 1920);
  const pixels = safeWidth * safeHeight;
  if (pixels > OUTPUT_MAX_PIXELS) {
    const scale = Math.sqrt(OUTPUT_MAX_PIXELS / pixels);
    safeWidth = Math.max(OUTPUT_MIN_DIMENSION, Math.floor(safeWidth * scale));
    safeHeight = Math.max(OUTPUT_MIN_DIMENSION, Math.floor(safeHeight * scale));
  }
  return { width: safeWidth, height: safeHeight };
}

export function normalizeOutput(raw: unknown, platform = "ios"): OutputSpec | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const source = raw as Record<string, unknown>;
  const builtin = BUILTIN_OUTPUTS.find((output) => output.id === source.id);
  if (builtin && builtin.kind !== "custom") {
    return {
      ...builtin,
      frame: typeof source.frame === "string" ? source.frame : builtin.frame,
    };
  }
  if (source.id !== "custom") return undefined;
  const dimensions = safeOutputDimensions(source.width, source.height);
  const store: StoreId = source.store === "appstore" ? "appstore" : "playstore";
  return {
    id: "custom",
    label: typeof source.label === "string" ? source.label : "Custom output",
    ...dimensions,
    store,
    kind: "custom",
    frame: typeof source.frame === "string" ? source.frame : platform,
  };
}

export function outputForSettings(settings: Settings): OutputSpec {
  return normalizeOutput(settings.output, settings.platform)
    ?? BUILTIN_OUTPUTS.find((output) => output.id === settings.platform)
    ?? BUILTIN_OUTPUTS[0];
}
