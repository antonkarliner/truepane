import { FONT_OPTIONS } from "./constants";
import { devicePolygon, resolveComposition } from "./composition";
import { getImageAsset } from "./media";
import { getRenderFrame } from "./render";
import type { AppState, Frame } from "./types";

export type PreflightIssueCode =
  | "missing-target-screenshot"
  | "missing-translation"
  | "locale-screenshot-fallback"
  | "screenshot-aspect-crop"
  | "text-block-overflow"
  | "device-excessive-crop"
  | "unresolved-font"
  | "low-fill-text-contrast";

export interface PreflightIssue {
  code: PreflightIssueCode;
  severity: "warning" | "info";
  message: string;
  slide: number;
  target: string;
  language: string;
}

function parseColor(value: string): [number, number, number] | null {
  const hex = value.trim().match(/^#([0-9a-f]{6})$/i)?.[1];
  if (hex) return [0, 2, 4].map((index) => parseInt(hex.slice(index, index + 2), 16)) as [number, number, number];
  const rgb = value.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i);
  return rgb ? [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])] : null;
}

function luminance(rgb: [number, number, number]): number {
  const channels = rgb.map((value) => {
    const channel = value / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrast(a: string, b: string): number | null {
  const left = parseColor(a);
  const right = parseColor(b);
  if (!left || !right) return null;
  const [bright, dark] = [luminance(left), luminance(right)].sort((x, y) => y - x);
  return (bright + 0.05) / (dark + 0.05);
}

function likelyTextOverflow(title: string, subhead: string, frame: Frame, width: number): boolean {
  const titleCapacity = Math.max(12, Math.floor((width * frame.W) / (frame.TEXT.titleFontSize * 0.54))) * 2;
  const subCapacity = Math.max(16, Math.floor((width * frame.W) / (frame.TEXT.subheadFontSize * 0.52))) * 2;
  return title.length > titleCapacity || subhead.length > subCapacity;
}

export function validateProject(state: AppState): PreflightIssue[] {
  const issues: PreflightIssue[] = [];
  const targets = state.settings.targets?.length ? state.settings.targets : [state.settings.platform];
  const languages = ["", ...(state.settings.languages ?? []).map((language) => language.code)];
  const knownFonts = new Set(FONT_OPTIONS.map((font) => font.id));
  if (state.settings.customFont?.name) knownFonts.add(state.settings.customFont.name);

  for (const target of targets) {
    const frame = getRenderFrame(target, state.settings.output);
    for (const language of languages) {
      const languageFont = language
        ? state.settings.languages?.find((item) => item.code === language)?.font
        : undefined;
      const font = languageFont ?? state.settings.fontFamily;
      for (let slideIndex = 0; slideIndex < state.slides.length; slideIndex++) {
        const slide = state.slides[slideIndex];
        const sourceAsset = getImageAsset(slide, target);
        const asset = getImageAsset(slide, target, language);
        const translation = language ? slide.translations?.[language] : undefined;
        const title = translation?.title?.trim() || slide.title;
        const subhead = translation?.subhead?.trim() || slide.subhead;
        const base = { slide: slideIndex, target, language };

        if (!sourceAsset.imageDataUrl) {
          issues.push({ ...base, code: "missing-target-screenshot", severity: "warning", message: "Target screenshot is missing." });
        }
        if (language && (!translation || !translation.title?.trim() || !translation.subhead?.trim())) {
          issues.push({ ...base, code: "missing-translation", severity: "warning", message: "Translated title or subtitle is missing." });
        }
        if (language && sourceAsset.imageDataUrl && asset === sourceAsset) {
          issues.push({ ...base, code: "locale-screenshot-fallback", severity: "info", message: "Locale uses this target's source screenshot." });
        }
        if (asset.width && asset.height) {
          const imageAspect = asset.width / asset.height;
          const screenAspect = frame.SCREEN.w / frame.SCREEN.h;
          if (Math.abs(imageAspect - screenAspect) / screenAspect > 0.02) {
            issues.push({ ...base, code: "screenshot-aspect-crop", severity: "warning", message: "Screenshot will be center-cropped to fill the device screen." });
          }
        }

        const composition = resolveComposition(slide.composition ?? state.settings.composition, frame);
        if (likelyTextOverflow(title, subhead, frame, composition.text.width)) {
          issues.push({ ...base, code: "text-block-overflow", severity: "warning", message: "Text may exceed the intended two-line blocks." });
        }
        const polygon = devicePolygon(composition, frame);
        const minX = Math.min(...polygon.map((point) => point.x));
        const maxX = Math.max(...polygon.map((point) => point.x));
        const minY = Math.min(...polygon.map((point) => point.y));
        const maxY = Math.max(...polygon.map((point) => point.y));
        const area = Math.max(1, (maxX - minX) * (maxY - minY));
        const visibleW = Math.max(0, Math.min(frame.W, maxX) - Math.max(0, minX));
        const visibleH = Math.max(0, Math.min(frame.H, maxY) - Math.max(0, minY));
        if ((visibleW * visibleH) / area < 0.8) {
          issues.push({ ...base, code: "device-excessive-crop", severity: "warning", message: "More than 20% of the device is outside the output." });
        }
        if (!knownFonts.has(font)) {
          issues.push({ ...base, code: "unresolved-font", severity: "warning", message: `Font "${font}" is not available in this project.` });
        }
        const background = slide.background ?? state.settings.background;
        const titleColor = slide.titleColor ?? state.settings.titleColor;
        const ratio = contrast(background.color, titleColor);
        if (ratio !== null && ratio < 3) {
          issues.push({
            ...base,
            code: "low-fill-text-contrast",
            severity: "warning",
            message: background.shape === "none"
              ? "Title contrast against the fill is low."
              : "Title contrast against the base fill is low; patterned pixels may differ.",
          });
        }
      }
    }
  }
  const targetOrder = new Map(targets.map((target, index) => [target, index]));
  const languageOrder = new Map(languages.map((language, index) => [language, index]));
  return issues.sort((a, b) =>
    (targetOrder.get(a.target) ?? 0) - (targetOrder.get(b.target) ?? 0) ||
    (languageOrder.get(a.language) ?? 0) - (languageOrder.get(b.language) ?? 0) ||
    a.slide - b.slide ||
    a.code.localeCompare(b.code),
  );
}
