import type {
  Composition,
  CompositionPreset,
  DevicePlacement,
  Frame,
  Slide,
  TextAlign,
  TextPlacement,
} from "./types";

export const COMPOSITION_PRESETS: { id: CompositionPreset; name: string }[] = [
  { id: "classic", name: "Classic" },
  { id: "hero", name: "Hero" },
  { id: "tilt-left", name: "Tilt left" },
  { id: "tilt-right", name: "Tilt right" },
  { id: "editorial", name: "Editorial" },
];

export interface ResolvedComposition {
  preset: CompositionPreset;
  text: TextPlacement;
  device: DevicePlacement;
}

export interface Point {
  x: number;
  y: number;
}

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));

function baseForPreset(preset: CompositionPreset, frame: Frame): ResolvedComposition {
  if (frame.W > frame.H) {
    const rotation = preset === "tilt-left" ? -6 : preset === "tilt-right" ? 6 : 0;
    const align: TextAlign = preset === "tilt-right" ? "right" : preset === "hero" ? "center" : "left";
    return {
      preset,
      text: {
        x: preset === "tilt-right" ? 0.08 : 0.06,
        y: preset === "editorial" ? 0.12 : 0.18,
        width: preset === "hero" ? 0.46 : 0.42,
        align,
      },
      device: {
        x: preset === "tilt-right" ? 0.72 : 0.76,
        y: 0.52,
        scale: preset === "hero" ? 1.08 : preset === "editorial" ? 0.9 : 1,
        rotation,
      },
    };
  }
  const classicText: TextPlacement = {
    x: frame.TEXT.leftPad / frame.W,
    y: frame.TEXT.titleTop / frame.H,
    width: (frame.W - frame.TEXT.leftPad - frame.TEXT.rightPad) / frame.W,
    align: "left",
  };
  const classicDevice: DevicePlacement = {
    x: (frame.BODY.x + frame.BODY.w / 2) / frame.W,
    y: (frame.BODY.y + frame.BODY.h / 2) / frame.H,
    scale: 1,
    rotation: 0,
  };
  if (preset === "classic") return { preset, text: classicText, device: classicDevice };
  if (preset === "hero") {
    return {
      preset,
      text: { x: 0.12, y: 0.065, width: 0.76, align: "center" },
      device: { x: 0.5, y: 0.69, scale: 1.14, rotation: 0 },
    };
  }
  if (preset === "tilt-left") {
    return {
      preset,
      text: { x: 0.085, y: 0.065, width: 0.79, align: "left" },
      device: { x: 0.59, y: 0.69, scale: 1.05, rotation: -6 },
    };
  }
  if (preset === "tilt-right") {
    return {
      preset,
      text: { x: 0.125, y: 0.065, width: 0.79, align: "right" },
      device: { x: 0.41, y: 0.69, scale: 1.05, rotation: 6 },
    };
  }
  return {
    preset,
    text: { x: 0.075, y: 0.055, width: 0.46, align: "left" },
    device: { x: 0.66, y: 0.69, scale: 0.86, rotation: 0 },
  };
}

export function normalizeComposition(raw: unknown): Composition {
  const src = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const presetIds = COMPOSITION_PRESETS.map((p) => p.id);
  const preset = presetIds.includes(src.preset as CompositionPreset)
    ? (src.preset as CompositionPreset)
    : "classic";
  const textSrc = src.text && typeof src.text === "object" ? (src.text as Record<string, unknown>) : {};
  const deviceSrc =
    src.device && typeof src.device === "object" ? (src.device as Record<string, unknown>) : {};
  const align: TextAlign | undefined = ["left", "center", "right"].includes(textSrc.align as string)
    ? (textSrc.align as TextAlign)
    : undefined;
  return {
    preset,
    text: {
      ...(typeof textSrc.x === "number" ? { x: clamp(textSrc.x, -0.5, 1.5) } : {}),
      ...(typeof textSrc.y === "number" ? { y: clamp(textSrc.y, -0.5, 1.5) } : {}),
      ...(typeof textSrc.width === "number" ? { width: clamp(textSrc.width, 0.2, 1.2) } : {}),
      ...(align ? { align } : {}),
    },
    device: {
      ...(typeof deviceSrc.x === "number" ? { x: clamp(deviceSrc.x, -0.5, 1.5) } : {}),
      ...(typeof deviceSrc.y === "number" ? { y: clamp(deviceSrc.y, -0.5, 1.5) } : {}),
      ...(typeof deviceSrc.scale === "number" ? { scale: clamp(deviceSrc.scale, 0.4, 1.6) } : {}),
      ...(typeof deviceSrc.rotation === "number"
        ? { rotation: clamp(deviceSrc.rotation, -20, 20) }
        : {}),
    },
  };
}

export function resolveComposition(raw: Composition | undefined, frame: Frame): ResolvedComposition {
  const normalized = normalizeComposition(raw);
  const base = baseForPreset(normalized.preset, frame);
  return {
    preset: normalized.preset,
    text: { ...base.text, ...normalized.text },
    device: { ...base.device, ...normalized.device },
  };
}

export function devicePolygon(composition: ResolvedComposition, frame: Frame): Point[] {
  const { device } = composition;
  const cx = device.x * frame.W;
  const cy = device.y * frame.H;
  const baseCx = frame.BODY.x + frame.BODY.w / 2;
  const baseCy = frame.BODY.y + frame.BODY.h / 2;
  const angle = (device.rotation * Math.PI) / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return [
    { x: frame.BODY.x, y: frame.BODY.y },
    { x: frame.BODY.x + frame.BODY.w, y: frame.BODY.y },
    { x: frame.BODY.x + frame.BODY.w, y: frame.BODY.y + frame.BODY.h },
    { x: frame.BODY.x, y: frame.BODY.y + frame.BODY.h },
  ].map((p) => {
    const x = (p.x - baseCx) * device.scale;
    const y = (p.y - baseCy) * device.scale;
    return { x: cx + x * cos - y * sin, y: cy + x * sin + y * cos };
  });
}

export function pointInPolygon(point: Point, polygon: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i];
    const b = polygon[j];
    const crosses =
      a.y > point.y !== b.y > point.y &&
      point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y || Number.EPSILON) + a.x;
    if (crosses) inside = !inside;
  }
  return inside;
}

export function clampDevicePosition(
  x: number,
  y: number,
  composition: ResolvedComposition,
  frame: Frame,
  visibleFraction = 0.2,
): Point {
  const halfW = (frame.BODY.w * composition.device.scale) / 2 / frame.W;
  const halfH = (frame.BODY.h * composition.device.scale) / 2 / frame.H;
  return {
    x: clamp(x, -halfW * (1 - visibleFraction), 1 + halfW * (1 - visibleFraction)),
    y: clamp(y, -halfH * (1 - visibleFraction), 1 + halfH * (1 - visibleFraction)),
  };
}

export function snapDevicePosition(x: number, y: number, threshold = 0.012): Point {
  return {
    x: Math.abs(x - 0.5) <= threshold ? 0.5 : x,
    y: Math.abs(y - 0.5) <= threshold ? 0.5 : y,
  };
}

/** Place one identical device across the boundary between two adjacent slides. */
export function spanDeviceAcrossPair(
  left: Slide,
  right: Slide,
  defaultComposition: Composition | undefined,
  frame: Frame,
  id: string,
): [Slide, Slide] {
  const source = normalizeComposition(left.composition ?? defaultComposition);
  const resolvedDevice = resolveComposition(source, frame).device;
  const shared = {
    y: resolvedDevice.y,
    scale: resolvedDevice.scale,
    rotation: resolvedDevice.rotation,
  };
  return [
    {
      ...left,
      deviceSpan: { id, role: "left" },
      composition: { ...source, device: { ...source.device, ...shared, x: 1 } },
    },
    {
      ...right,
      deviceSpan: { id, role: "right" },
      image: left.image,
      imageDataUrl: left.imageDataUrl,
      media: left.media,
      composition: {
        ...normalizeComposition(right.composition ?? defaultComposition),
        device: { ...shared, x: 0 },
      },
    },
  ];
}

/** Update either half of a linked device and translate its center across the slide boundary. */
export function updateSpannedComposition(
  slides: Slide[],
  index: number,
  composition: Composition,
  frame: Frame,
): Slide[] {
  const next = slides.slice();
  const slide = next[index];
  if (!slide) return slides;
  next[index] = { ...slide, composition };
  if (!slide.deviceSpan) return next;
  const partnerIndex = next.findIndex(
    (candidate, i) => i !== index && candidate.deviceSpan?.id === slide.deviceSpan?.id,
  );
  if (partnerIndex < 0) return next;
  const partner = next[partnerIndex];
  const sourceDevice = resolveComposition(composition, frame).device;
  const sourceX = sourceDevice.x;
  const partnerX = slide.deviceSpan.role === "left" ? sourceX - 1 : sourceX + 1;
  const partnerComposition = normalizeComposition(partner.composition);
  next[partnerIndex] = {
    ...partner,
    composition: {
      ...partnerComposition,
      device: {
        ...partnerComposition.device,
        ...sourceDevice,
        x: partnerX,
      },
    },
  };
  return next;
}

/** Mirror screenshot media to the other half of a linked device. */
export function mirrorSpannedMedia(slides: Slide[], index: number): Slide[] {
  const source = slides[index];
  if (!source?.deviceSpan) return slides;
  const partnerIndex = slides.findIndex(
    (candidate, i) => i !== index && candidate.deviceSpan?.id === source.deviceSpan?.id,
  );
  if (partnerIndex < 0) return slides;
  const next = slides.slice();
  next[partnerIndex] = {
    ...next[partnerIndex],
    image: source.image,
    imageDataUrl: source.imageDataUrl,
    media: source.media,
  };
  return next;
}
