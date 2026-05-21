import { describe, expect, it } from "vitest";
import { RING_LAYOUTS, defineFrame, getFrame, getLayout, mulberry32, wrapText } from "./render";
import type { Frame } from "./types";

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
