import { describe, expect, it } from "vitest";
import { applyBrandKit, brandKitFromSettings, MAX_BRAND_KIT_BYTES, normalizeBrandKit } from "./brand-kit";
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

  // A brand backdrop belongs in a brand kit, so the image rides along with the
  // background. It is also the largest thing a kit can carry, and kits are
  // shared as files between people — an unbounded one is a footgun handed over.
  describe("background images in kits", () => {
    const image = (dataUrl: string) => ({
      source: { kind: "upload" as const, id: "bg1", dataUrl, width: 1320, height: 2868 },
      span: "slide" as const,
      fit: "cover" as const,
      opacity: 1,
      scrim: 0.3,
      scrimColor: "#000000",
      meanLuminance: 0.4,
    });

    it("carries a brand backdrop through capture, export, and re-import", () => {
      const state = defaultState();
      state.settings.background = {
        ...state.settings.background,
        image: image("data:image/jpeg;base64,AAAA"),
      };
      const kit = brandKitFromSettings("Backdrop", state.settings, "kit-4");
      const roundTripped = normalizeBrandKit(JSON.parse(JSON.stringify(kit)));
      expect(roundTripped.style.background.image?.source).toEqual(kit.style.background.image?.source);
      expect(roundTripped.style.background.image?.scrim).toBe(0.3);
    });

    it("stays under the kit size ceiling — a 2 MB image is well inside 8 MB", () => {
      const state = defaultState();
      state.settings.background = {
        ...state.settings.background,
        image: image(`data:image/jpeg;base64,${"A".repeat(2 * 1024 * 1024)}`),
      };
      const kit = brandKitFromSettings("Heavy", state.settings, "kit-5");
      expect(JSON.stringify(kit).length).toBeLessThan(MAX_BRAND_KIT_BYTES);
      expect(() => normalizeBrandKit(JSON.parse(JSON.stringify(kit)))).not.toThrow();
    });

    it("rejects a kit whose image exceeds the ceiling", () => {
      expect(() => normalizeBrandKit({
        version: 1,
        style: { background: { image: image("x".repeat(MAX_BRAND_KIT_BYTES + 1)) } },
      })).toThrow(/too large/);
    });

    it("clears per-slide background images when overrides are cleared", () => {
      const state = defaultState();
      state.slides[0].background = {
        ...state.settings.background,
        image: image("data:image/jpeg;base64,AAAA"),
      };
      const kit = brandKitFromSettings("New", state.settings, "kit-6");
      expect(applyBrandKit(state, kit).slides[0].background?.image).toBeTruthy();
      expect(applyBrandKit(state, kit, true).slides[0].background).toBeUndefined();
    });
  });
});
