import { describe, expect, it } from "vitest";
import { defaultState } from "./constants";
import {
  buildReleaseSignatures,
  compareRelease,
  createReleaseBaseline,
  sha256Hex,
} from "./release";

describe("release signatures", () => {
  it("uses the same SHA-256 hex contract in this browser/Node-compatible core", async () => {
    expect(await sha256Hex("truepane")).toBe("b3d9317d06c5063315c42d81210248b1a0dbb0de902e8eb2bf4d671ec05f69ce");
  });

  it("classifies added, unchanged, changed, and removed assets", async () => {
    const state = defaultState();
    expect((await compareRelease(state)).every((row) => row.status === "added")).toBe(true);
    state.releaseBaseline = await createReleaseBaseline(state);
    expect((await compareRelease(state)).every((row) => row.status === "unchanged")).toBe(true);
    state.slides[0].title = "Changed";
    expect((await compareRelease(state)).some((row) => row.status === "changed")).toBe(true);
    state.slides.pop();
    expect((await compareRelease(state)).some((row) => row.status === "removed")).toBe(true);
  });

  it("changes every signature when the renderer schema version changes", async () => {
    const state = defaultState();
    const before = await buildReleaseSignatures(state, 1);
    const after = await buildReleaseSignatures(state, 2);
    expect(Object.keys(before).every((key) => before[key] !== after[key])).toBe(true);
  });
});
