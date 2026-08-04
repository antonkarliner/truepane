import { describe, expect, it } from "vitest";
import { defaultState } from "./constants";
import { setImageAsset } from "./media";
import { validateProject } from "./preflight";

describe("release preflight", () => {
  it("returns stable issue codes in target/language/slide order", () => {
    const state = defaultState();
    state.settings.targets = ["ios", "android"];
    state.settings.languages = [{ code: "fr", name: "French" }];
    state.slides[0] = setImageAsset(state.slides[0], "ios", "", {
      imageDataUrl: "data:image/png;base64,x",
      width: 1000,
      height: 1000,
    });
    const first = validateProject(state);
    const second = validateProject(state);
    expect(second).toEqual(first);
    expect(first.some((issue) => issue.code === "screenshot-aspect-crop")).toBe(true);
    expect(first.some((issue) => issue.code === "missing-target-screenshot" && issue.target === "android")).toBe(true);
    expect(first.some((issue) => issue.code === "missing-translation" && issue.language === "fr")).toBe(true);
    expect(first.some((issue) => issue.code === "locale-screenshot-fallback")).toBe(true);
  });

  // The device is painted over the text, so overlap is text the user cannot
  // read. Free placement (plan 010) makes parking a headline under the phone a
  // one-drag mistake, and on canvas the drag outline stays visible while the
  // text vanishes — nothing else in the app would tell them.
  it("flags text parked behind the device, and stays quiet for the presets", () => {
    const clean = defaultState();
    expect(validateProject(clean).map((i) => i.code)).not.toContain("text-behind-device");

    const buried = defaultState();
    // Default iOS device center is ~y 0.69; drop the text block onto it.
    buried.settings.composition = { preset: "classic", text: { x: 0.1, y: 0.6, width: 0.8 } };
    const issue = validateProject(buried).find((i) => i.code === "text-behind-device");
    expect(issue?.severity).toBe("warning");
    expect(issue?.message).toMatch(/behind the device/);
  });

  it("keeps every built-in composition preset free of hidden text", () => {
    for (const preset of ["classic", "hero", "tilt-left", "tilt-right", "editorial"] as const) {
      const state = defaultState();
      state.settings.composition = { preset };
      const codes = validateProject(state).map((issue) => issue.code);
      expect(codes, `preset ${preset} hides its own text`).not.toContain("text-behind-device");
    }
  });

  it("flags unresolved fonts and low fill contrast", () => {
    const state = defaultState();
    state.settings.fontFamily = "Missing Font";
    state.settings.background.color = "#ffffff";
    state.settings.titleColor = "#eeeeee";
    const codes = validateProject(state).map((issue) => issue.code);
    expect(codes).toContain("unresolved-font");
    expect(codes).toContain("low-fill-text-contrast");
  });
});
