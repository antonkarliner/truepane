import { describe, expect, it } from "vitest";
import { applyBrandKit, brandKitFromSettings, normalizeBrandKit } from "./brand-kit";
import { defaultState } from "./constants";

describe("brand kits", () => {
  it("captures style and composition without project content", () => {
    const state = defaultState();
    state.settings.composition = { preset: "tilt-left", device: { rotation: -12 } };
    const kit = brandKitFromSettings("Coffee", state.settings, "kit-1");
    expect(kit.style.composition.preset).toBe("tilt-left");
    expect(JSON.stringify(kit)).not.toContain("slides");
    expect(JSON.stringify(kit)).not.toContain("targets");
  });

  it("applies only style defaults and preserves project media and languages", () => {
    const state = defaultState();
    state.settings.targets = ["ios", "android"];
    state.settings.languages = [{ code: "fr", name: "French" }];
    state.slides[0].media = { ios: { source: { imageDataUrl: "data:x" } } };
    state.slides[0].background = { ...state.settings.background, color: "#000000" };
    const kit = brandKitFromSettings("New", { ...state.settings, titleColor: "#123456" }, "kit-2");
    const applied = applyBrandKit(state, kit);
    expect(applied.settings.titleColor).toBe("#123456");
    expect(applied.settings.targets).toEqual(["ios", "android"]);
    expect(applied.settings.languages).toEqual([{ code: "fr", name: "French" }]);
    expect(applied.slides[0].media).toBe(state.slides[0].media);
    expect(applied.slides[0].background?.color).toBe("#000000");
  });

  it("clears slide style overrides only when explicitly requested", () => {
    const state = defaultState();
    state.slides[0].titleColor = "#000000";
    const kit = brandKitFromSettings("New", state.settings, "kit-3");
    expect(applyBrandKit(state, kit).slides[0].titleColor).toBe("#000000");
    expect(applyBrandKit(state, kit, true).slides[0].titleColor).toBeUndefined();
  });

  it("rejects malformed and oversized kits", () => {
    expect(() => normalizeBrandKit({ version: 2 })).toThrow(/version/);
    expect(() => normalizeBrandKit({
      version: 1,
      style: { customFont: { name: "Huge", dataUrl: "x".repeat(8 * 1024 * 1024 + 1) } },
    })).toThrow(/too large/);
  });
});
