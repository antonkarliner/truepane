import type { ImageAsset, Slide, TargetMedia } from "./types";

export function emptyImageAsset(): ImageAsset {
  return { image: null, imageDataUrl: null };
}

export function getImageAsset(
  slide: Slide,
  target: string,
  language = "",
): ImageAsset {
  const media = slide.media?.[target];
  if (language) {
    const localized = media?.locales?.[language];
    if (localized?.image || localized?.imageDataUrl) return localized;
  }
  if (media?.source) return media.source;
  // Runtime-only v1 compatibility. Persisted/imported v1 projects are migrated
  // before use, so this cannot leak a migrated screenshot across targets.
  if (!slide.media) {
    const legacyLocale = language ? slide.translations?.[language] : undefined;
    if (legacyLocale?.image || legacyLocale?.imageDataUrl) {
      return {
        image: legacyLocale.image ?? null,
        imageDataUrl: legacyLocale.imageDataUrl ?? null,
      };
    }
    return { image: slide.image, imageDataUrl: slide.imageDataUrl };
  }
  return emptyImageAsset();
}

export function setImageAsset(
  slide: Slide,
  target: string,
  language: string,
  asset: ImageAsset,
): Slide {
  const normalizedAsset: ImageAsset = {
    ...asset,
    width: asset.width ?? asset.image?.naturalWidth ?? asset.image?.width,
    height: asset.height ?? asset.image?.naturalHeight ?? asset.image?.height,
  };
  const current: TargetMedia = slide.media?.[target] ?? {};
  const targetMedia: TargetMedia = language
    ? { ...current, locales: { ...current.locales, [language]: normalizedAsset } }
    : { ...current, source: normalizedAsset };
  return { ...slide, media: { ...slide.media, [target]: targetMedia } };
}

export function serializeMedia(
  media: Record<string, TargetMedia> | undefined,
): Record<string, TargetMedia> | undefined {
  if (!media) return undefined;
  const out: Record<string, TargetMedia> = {};
  for (const [target, value] of Object.entries(media)) {
    const source = value.source?.imageDataUrl
      ? {
          imageDataUrl: value.source.imageDataUrl,
          width: value.source.width,
          height: value.source.height,
        }
      : undefined;
    const locales = Object.fromEntries(
      Object.entries(value.locales ?? {})
        .filter(([, asset]) => !!asset.imageDataUrl)
        .map(([code, asset]) => [code, {
          imageDataUrl: asset.imageDataUrl,
          width: asset.width,
          height: asset.height,
        }]),
    );
    if (source || Object.keys(locales).length) {
      out[target] = {
        ...(source ? { source } : {}),
        ...(Object.keys(locales).length ? { locales } : {}),
      };
    }
  }
  return Object.keys(out).length ? out : undefined;
}
