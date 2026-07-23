import { describe, expect, it } from "vitest";
import {
  clampDevicePosition,
  devicePolygon,
  normalizeComposition,
  pointInPolygon,
  resolveComposition,
  snapDevicePosition,
  spanDeviceAcrossPair,
  updateSpannedComposition,
  mirrorSpannedMedia,
} from "./composition";
import { getFrame } from "./render";

describe("composition", () => {
  const frame = getFrame("ios");

  it("preserves legacy geometry for the classic preset", () => {
    const resolved = resolveComposition({ preset: "classic" }, frame);
    expect(resolved.text.x * frame.W).toBeCloseTo(frame.TEXT.leftPad);
    expect(resolved.text.y * frame.H).toBeCloseTo(frame.TEXT.titleTop);
    expect(resolved.device.x * frame.W).toBeCloseTo(frame.BODY.x + frame.BODY.w / 2);
    expect(resolved.device.y * frame.H).toBeCloseTo(frame.BODY.y + frame.BODY.h / 2);
    expect(resolved.device).toMatchObject({ scale: 1, rotation: 0 });
  });

  it("clamps persisted rotation and scale", () => {
    expect(
      normalizeComposition({ preset: "hero", device: { rotation: 99, scale: 9 } }).device,
    ).toMatchObject({ rotation: 20, scale: 1.6 });
  });

  it("hit-tests a rotated device polygon", () => {
    const resolved = resolveComposition({ preset: "tilt-right" }, frame);
    const polygon = devicePolygon(resolved, frame);
    expect(pointInPolygon({ x: resolved.device.x * frame.W, y: resolved.device.y * frame.H }, polygon)).toBe(true);
    expect(pointInPolygon({ x: 0, y: 0 }, polygon)).toBe(false);
  });

  it("snaps near the canvas center", () => {
    expect(snapDevicePosition(0.506, 0.494)).toEqual({ x: 0.5, y: 0.5 });
    expect(snapDevicePosition(0.53, 0.47)).toEqual({ x: 0.53, y: 0.47 });
  });

  it("keeps a recoverable part of the device visible", () => {
    const resolved = resolveComposition({ preset: "classic" }, frame);
    const point = clampDevicePosition(-10, 10, resolved, frame);
    expect(point.x).toBeGreaterThan(-1);
    expect(point.y).toBeLessThan(2);
  });

  it("creates matching clipped halves while preserving each slide's text", () => {
    const left = { title: "Left", subhead: "", image: null, imageDataUrl: "same", composition: { preset: "tilt-left" as const } };
    const right = { title: "Right", subhead: "", image: null, imageDataUrl: "old", composition: { preset: "editorial" as const } };
    const [a, b] = spanDeviceAcrossPair(left, right, { preset: "classic" }, frame, "pair");
    expect(a.title).toBe("Left");
    expect(b.title).toBe("Right");
    expect(a.composition?.device).toMatchObject({ x: 1, rotation: -6 });
    expect(b.composition?.device).toMatchObject({ x: 0, rotation: -6 });
    expect(b.imageDataUrl).toBe("same");
    expect(a.deviceSpan).toEqual({ id: "pair", role: "left" });
    expect(b.deviceSpan).toEqual({ id: "pair", role: "right" });
  });

  it("keeps rotation and translated movement synchronized across a span", () => {
    const base = { title: "", subhead: "", image: null, imageDataUrl: null };
    const [left, right] = spanDeviceAcrossPair(base, base, { preset: "classic" }, frame, "pair");
    const moved = updateSpannedComposition([left, right], 1, {
      ...right.composition!,
      device: { ...right.composition!.device, x: 0.12, y: 0.7, rotation: 14 },
    }, frame);
    expect(moved[0].composition?.device).toMatchObject({ x: 1.12, y: 0.7, rotation: 14 });
    expect(moved[1].composition?.device).toMatchObject({ x: 0.12, y: 0.7, rotation: 14 });
  });

  it("mirrors screenshot replacement and clearing across a span", () => {
    const base = { title: "", subhead: "", image: null, imageDataUrl: null };
    const pair = spanDeviceAcrossPair(base, base, { preset: "classic" }, frame, "pair");
    pair[1] = {
      ...pair[1],
      media: { ios: { source: { imageDataUrl: "new" } } },
    };
    const replaced = mirrorSpannedMedia(pair, 1);
    expect(replaced[0].media?.ios?.source?.imageDataUrl).toBe("new");
    replaced[0] = { ...replaced[0], media: undefined };
    const cleared = mirrorSpannedMedia(replaced, 0);
    expect(cleared[1].media).toBeUndefined();
  });
});
