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
