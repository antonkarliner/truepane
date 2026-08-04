import { describe, expect, it } from "vitest";
import { defaultState } from "./constants";
import {
  buildReleaseSignatures,
  compareRelease,
  createReleaseBaseline,
  sha256Hex,
} from "./release";

// Captured from the build that shipped release baselines, before the
// background image layer existed. See the byte-stability test below.
const DEFAULT_SIGNATURES = {
  "ios/ios/source/slide-01": "14fb72c52d60927e5171b19f80015c0958b5ceed9f70e6cc6f101eac205e835d",
  "ios/ios/source/slide-02": "140ddc9b85268624c76ebbe9c37081329a1cdb134ca8465894bd8e0780e47e09",
  "ios/ios/source/slide-03": "0e6e87892ee3591bcb15d36c5dc7c3bd1c4d79c64ebcadeef5660d4bb9c73843",
  "ios/ios/source/slide-04": "f250d330781001e86ac0fa51162bbbc2d5508e08548e5e0f9b78aebf0720b9a6",
  "ios/ios/source/slide-05": "256d083aa037233f064d530aa8cefbb456660289f127c989398c4b0b8f4a452c",
};

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

  it("identifies a background image by content id, not by its bytes", async () => {
    // Two loads of the same picture: identical id, different data URL text
    // (a re-encode, a different MIME prefix, a re-download). The signature
    // must not move — otherwise every reopen of a project reports every slide
    // as changed and changed-only export stops meaning anything.
    const image = (id: string, dataUrl: string) => ({
      source: { kind: "upload" as const, id, dataUrl, width: 1200, height: 800 },
      span: "slide" as const,
      fit: "cover" as const,
      opacity: 1,
      scrim: 0,
      scrimColor: "#000000",
      meanLuminance: 0.4,
    });

    const withImage = async (id: string, dataUrl: string) => {
      const state = defaultState();
      state.settings.background = { ...state.settings.background, image: image(id, dataUrl) };
      return buildReleaseSignatures(state);
    };

    const first = await withImage("abc123", "data:image/jpeg;base64,AAAA");
    const reEncoded = await withImage("abc123", "data:image/jpeg;base64,BBBBBBBB");
    const different = await withImage("def456", "data:image/jpeg;base64,AAAA");

    expect(reEncoded).toEqual(first);
    expect(Object.keys(first).every((key) => first[key] !== different[key])).toBe(true);
  });

  it("keeps the default project's signatures byte-stable", async () => {
    // Pinned, not recomputed. Every baseline a user has already stored was
    // built from this payload shape; a field appearing or disappearing in the
    // signature silently reports every asset as changed on their next
    // compare. Update these hashes only for a deliberate, announced break.
    expect(await buildReleaseSignatures(defaultState())).toEqual(DEFAULT_SIGNATURES);
  });

  it("changes every signature when the renderer schema version changes", async () => {
    const state = defaultState();
    const before = await buildReleaseSignatures(state, 1);
    const after = await buildReleaseSignatures(state, 2);
    expect(Object.keys(before).every((key) => before[key] !== after[key])).toBe(true);
  });
});
