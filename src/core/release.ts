import { getImageAsset } from "./media";
import { outputForSettings } from "./output";
import type {
  AppState,
  ReleaseAssetComparison,
  ReleaseBaseline,
} from "./types";

export const RELEASE_BASELINE_VERSION = 1;
export const RENDERER_SCHEMA_VERSION = 2;

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${canonical(object[key])}`).join(",")}}`;
}

export async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function releaseAssetKey(target: string, output: string, language: string, slide: number): string {
  return `${target}/${output}/${language || "source"}/slide-${String(slide + 1).padStart(2, "0")}`;
}

function parseReleaseKey(key: string): Omit<ReleaseAssetComparison, "key" | "status"> {
  const [target = "", output = "", language = "source", slidePart = "slide-01"] = key.split("/");
  return {
    target,
    output,
    language: language === "source" ? "" : language,
    slide: Math.max(0, Number(slidePart.replace("slide-", "")) - 1),
  };
}

export async function buildReleaseSignatures(
  state: AppState,
  rendererVersion = RENDERER_SCHEMA_VERSION,
): Promise<Record<string, string>> {
  const targets = state.settings.targets?.length ? state.settings.targets : [state.settings.platform];
  const languages = ["", ...(state.settings.languages ?? []).map((language) => language.code)];
  const output = outputForSettings(state.settings);
  const entries: [string, string][] = [];
  for (const target of targets) {
    for (const language of languages) {
      for (let slideIndex = 0; slideIndex < state.slides.length; slideIndex++) {
        const slide = state.slides[slideIndex];
        const translation = language ? slide.translations?.[language] : undefined;
        const asset = getImageAsset(slide, target, language);
        const payload = {
          rendererVersion,
          order: slideIndex,
          target,
          language,
          output,
          text: {
            title: translation?.title?.trim() || slide.title,
            subhead: translation?.subhead?.trim() || slide.subhead,
          },
          screenshot: asset.imageDataUrl ?? null,
          style: {
            fontFamily: language
              ? state.settings.languages?.find((item) => item.code === language)?.font ?? state.settings.fontFamily
              : state.settings.fontFamily,
            customFont: state.settings.customFont,
            titleColor: slide.titleColor ?? state.settings.titleColor,
            titleScale: state.settings.titleScale,
            titleWeight: state.settings.titleWeight,
            subheadColor: slide.subheadColor ?? state.settings.subheadColor,
            subtitleScale: state.settings.subtitleScale,
            subtitleWeight: state.settings.subtitleWeight,
            background: slide.background ?? state.settings.background,
            composition: slide.composition ?? state.settings.composition,
          },
        };
        const key = releaseAssetKey(target, output.id, language, slideIndex);
        entries.push([key, await sha256Hex(canonical(payload))]);
      }
    }
  }
  return Object.fromEntries(entries);
}

export async function compareRelease(state: AppState): Promise<ReleaseAssetComparison[]> {
  const current = await buildReleaseSignatures(state);
  const baseline = state.releaseBaseline?.signatures ?? {};
  const rows: ReleaseAssetComparison[] = Object.keys(current).sort().map((key) => ({
    key,
    status: baseline[key] === undefined ? "added" : baseline[key] === current[key] ? "unchanged" : "changed",
    ...parseReleaseKey(key),
  }));
  for (const key of Object.keys(baseline).sort()) {
    if (current[key] !== undefined) continue;
    rows.push({ key, status: "removed", ...parseReleaseKey(key) });
  }
  return rows.sort((a, b) => a.key.localeCompare(b.key) || a.status.localeCompare(b.status));
}

export async function createReleaseBaseline(state: AppState): Promise<ReleaseBaseline> {
  return {
    version: RELEASE_BASELINE_VERSION,
    rendererVersion: RENDERER_SCHEMA_VERSION,
    createdAt: new Date().toISOString(),
    signatures: await buildReleaseSignatures(state),
  };
}
