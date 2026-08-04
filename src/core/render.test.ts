import { describe, expect, it } from "vitest";
import {
  RING_LAYOUTS,
  backgroundImageRect,
  defineFrame,
  getFrame,
  getLayout,
  layoutTextBlock,
  mulberry32,
  wrapText,
} from "./render";
import { defaultState } from "./constants";
import type { Composition, Frame, Slide } from "./types";

// A fake 2D context whose text width is proportional to string length, so the
// wrapping logic is deterministic without a real canvas.
const fakeCtx = {
  measureText: (s: string) => ({ width: s.length * 10 }),
} as unknown as CanvasRenderingContext2D;

describe("wrapText", () => {
  it("returns no lines for empty text", () => {
    expect(wrapText(fakeCtx, "", 100)).toEqual([]);
  });

  it("wraps when a word would overflow the max width", () => {
    // Each char = 10px. maxWidth 65 fits "aa bb" (50) but not "aa bb cc" (80).
    expect(wrapText(fakeCtx, "aa bb cc", 65)).toEqual(["aa bb", "cc"]);
  });

  it("keeps everything on one line when it fits", () => {
    expect(wrapText(fakeCtx, "a b c", 1000)).toEqual(["a b c"]);
  });
});

describe("getLayout", () => {
  it("resolves a known layout id", () => {
    expect(getLayout("drift").id).toBe("drift");
  });

  it("falls back to the first layout for an unknown id", () => {
    expect(getLayout("does-not-exist").id).toBe(RING_LAYOUTS[0].id);
  });

  it("every layout produces at least one group", () => {
    for (const layout of RING_LAYOUTS) {
      expect(layout.groups(3).length).toBeGreaterThan(0);
    }
  });
});

describe("mulberry32", () => {
  it("is deterministic for a given seed", () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const seqA = [a(), a(), a()];
    const seqB = [b(), b(), b()];
    expect(seqA).toEqual(seqB);
  });

  it("produces different sequences for different seeds", () => {
    const a = mulberry32(1);
    const b = mulberry32(2);
    expect(a()).not.toBe(b());
  });

  it("stays within [0, 1)", () => {
    const r = mulberry32(123);
    for (let i = 0; i < 100; i++) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe("concentric-corner invariant", () => {
  function center(frame: Frame) {
    return {
      cx: [frame.BODY.x + frame.BODY.r, frame.BEZEL.x + frame.BEZEL.r, frame.SCREEN.x + frame.SCREEN.r],
      cy: [frame.BODY.y + frame.BODY.r, frame.BEZEL.y + frame.BEZEL.r, frame.SCREEN.y + frame.SCREEN.r],
    };
  }

  it("shipped frames share a center of curvature", () => {
    for (const platform of ["ios", "android"]) {
      const { cx, cy } = center(getFrame(platform));
      expect(new Set(cx).size).toBe(1);
      expect(new Set(cy).size).toBe(1);
    }
  });

  it("defineFrame rejects a frame that breaks the invariant", () => {
    const bad = {
      ...getFrame("ios"),
      id: "bad",
      // Shift the screen rect's corner center off the body/bezel center.
      SCREEN: { x: 0, y: 765, w: 930, h: 2000, r: 132 },
    } as Frame;
    expect(() => defineFrame(bad)).toThrow(/concentric-corner invariant/);
  });
});

// The text hit-region in the editor is derived from this layout, so the box it
// reports must be the box the painter fills — no phantom space for text that
// is not there, and no lag behind wrapping.
describe("layoutTextBlock", () => {
  const frame = getFrame("ios");
  const settings = defaultState().settings;
  const slideWith = (title: string, subhead: string, composition?: Composition): Slide => ({
    title,
    subhead,
    image: null,
    imageDataUrl: null,
    composition,
  });

  it("stops the box at the title bottom when there is no subhead", () => {
    const layout = layoutTextBlock(fakeCtx, slideWith("aa", ""), settings, frame);
    expect(layout.titleLines).toEqual(["aa"]);
    expect(layout.subheadLines).toEqual([]);
    expect(layout.bounds.h).toBeCloseTo(frame.TEXT.titleLineHeight);
  });

  it("grows the box by one line height per wrapped title line", () => {
    // Narrowest column normalizeComposition allows: 0.2 * 1320 = 264px, and
    // the fake ctx measures 10px per character.
    const narrow: Composition = { preset: "classic", text: { width: 0.2 } };
    const one = layoutTextBlock(fakeCtx, slideWith("aaaaaaaaaa", "", narrow), settings, frame);
    const two = layoutTextBlock(
      fakeCtx,
      slideWith("aaaaaaaaaa bbbbbbbbbb cccccccccc", "", narrow),
      settings,
      frame,
    );
    expect(one.titleLines).toHaveLength(1);
    expect(two.titleLines).toHaveLength(2);
    expect(two.bounds.h - one.bounds.h).toBeCloseTo(frame.TEXT.titleLineHeight);
  });

  it("extends the box to the subhead bottom", () => {
    const titleOnly = layoutTextBlock(fakeCtx, slideWith("aa", ""), settings, frame);
    const withSub = layoutTextBlock(fakeCtx, slideWith("aa", "bb"), settings, frame);
    expect(withSub.subheadLines).toEqual(["bb"]);
    expect(withSub.subhead!.y).toBeCloseTo(
      withSub.bounds.y + (frame.TEXT.subheadTop - frame.TEXT.titleTop),
    );
    expect(withSub.bounds.h).toBeCloseTo(
      frame.TEXT.subheadTop - frame.TEXT.titleTop + frame.TEXT.subheadLineHeight,
    );
    expect(withSub.bounds.h).toBeGreaterThan(titleOnly.bounds.h);
  });

  it("reports the placed text column, so the box tracks x and width", () => {
    const composition: Composition = { preset: "classic", text: { x: 0.2, width: 0.5 } };
    const layout = layoutTextBlock(fakeCtx, slideWith("aa", "", composition), settings, frame);
    expect(layout.bounds.x).toBeCloseTo(0.2 * frame.W);
    expect(layout.bounds.w).toBeCloseTo(0.5 * frame.W);
  });
});

describe("backgroundImageRect", () => {
  const F = { W: 1000, H: 2000 } as Frame;

  // The whole point of strip span: a long backdrop must flow across slide
  // boundaries as one image. If consecutive slides are not offset by exactly
  // one slide width, every seam shows a jump and the feature is worthless.
  it("shifts by exactly one slide width per slide in strip span", () => {
    const a = backgroundImageRect(4000, 2000, F, 4, 0, "strip", "cover");
    const b = backgroundImageRect(4000, 2000, F, 4, 1, "strip", "cover");
    const c = backgroundImageRect(4000, 2000, F, 4, 2, "strip", "cover");
    expect(b.dx).toBeCloseTo(a.dx - F.W);
    expect(c.dx).toBeCloseTo(b.dx - F.W);
    expect(b.dy).toBeCloseTo(a.dy);
    expect(b.dw).toBeCloseTo(a.dw);
  });

  // Cover must leave no gap; a letterboxed "cover" would show the fill through
  // the edges of a photo the user expected to bleed.
  it("always covers the destination box", () => {
    for (const [iw, ih] of [[100, 4000], [4000, 100], [1000, 2000], [3, 7]]) {
      const r = backgroundImageRect(iw, ih, F, 3, 1, "strip", "cover");
      const boxW = F.W * 3;
      expect(r.dw).toBeGreaterThanOrEqual(boxW - 0.001);
      expect(r.dh).toBeGreaterThanOrEqual(F.H - 0.001);
    }
  });

  it("never crops in contain", () => {
    for (const [iw, ih] of [[100, 4000], [4000, 100], [1000, 2000]]) {
      const r = backgroundImageRect(iw, ih, F, 1, 0, "slide", "contain");
      expect(r.dw).toBeLessThanOrEqual(F.W + 0.001);
      expect(r.dh).toBeLessThanOrEqual(F.H + 0.001);
    }
  });

  it("is independent of slide index and count in slide span", () => {
    const a = backgroundImageRect(1500, 1500, F, 1, 0, "slide", "cover");
    const b = backgroundImageRect(1500, 1500, F, 9, 7, "slide", "cover");
    expect(b).toEqual(a);
  });

  it("degrades to the box for a zero-sized image instead of dividing by zero", () => {
    const r = backgroundImageRect(0, 0, F, 2, 0, "strip", "cover");
    expect(Number.isFinite(r.dw) && Number.isFinite(r.dh)).toBe(true);
  });
});
