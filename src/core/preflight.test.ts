import { describe, expect, it } from "vitest";
import { defaultState } from "./constants";
import { setImageAsset } from "./media";
import { validateProject } from "./preflight";
import type { BackgroundImage } from "./types";

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

  // A background image replaces the fill behind the text. Judging contrast
  // against the fill once an image covers it is measuring pixels nobody sees:
  // a dark title over a dark photo on a white fill would pass silently, which
  // is the exact case this feature makes easy to create.
  describe("background image contrast", () => {
    const withImage = (
      patch: Partial<BackgroundImage> = {},
      size: { width?: number; height?: number } = {},
    ) => {
      const state = defaultState();
      state.settings.background = {
        ...state.settings.background,
        color: "#ffffff",
        image: {
          source: {
            kind: "upload",
            id: "abc",
            dataUrl: "data:image/jpeg;base64,x",
            width: size.width ?? 1320,
            height: size.height ?? 2868,
          },
          span: "slide",
          fit: "cover",
          opacity: 1,
          scrim: 0,
          scrimColor: "#000000",
          meanLuminance: 0.02, // a dark photograph
          ...patch,
        },
      };
      state.settings.titleColor = "#1a1612"; // dark title
      return state;
    };

    it("judges the title against the image, not the fill it covers", () => {
      const codes = validateProject(withImage()).map((issue) => issue.code);
      expect(codes).toContain("low-image-text-contrast");
      // The white fill would have passed on its own — that is the bug.
      expect(codes).not.toContain("low-fill-text-contrast");
    });

    it("clears once a light scrim lifts the backdrop", () => {
      const codes = validateProject(withImage({ scrim: 0.85, scrimColor: "#ffffff" })).map((i) => i.code);
      expect(codes).not.toContain("low-image-text-contrast");
    });

    it("lets a low-opacity image fall back toward the fill it blends with", () => {
      const codes = validateProject(withImage({ opacity: 0.05 })).map((i) => i.code);
      expect(codes).not.toContain("low-image-text-contrast");
    });

    it("says the image will be cropped when its aspect does not match the box", () => {
      const state = withImage({}, { width: 1000, height: 1000 });
      const issue = validateProject(state).find((i) => i.code === "background-image-aspect-mismatch");
      expect(issue?.severity).toBe("info");
      expect(issue?.message).toMatch(/center-cropped/);
    });

    it("stays quiet when the image already matches the slide", () => {
      const codes = validateProject(withImage()).map((i) => i.code);
      expect(codes).not.toContain("background-image-aspect-mismatch");
    });

    // Strip span measures against W*N, so an image sized for one slide is the
    // mismatch and a long panorama is the correct one. Getting this backwards
    // would tell every strip user their correct image is wrong.
    it("measures strip span against the whole strip, not one slide", () => {
      const state = withImage({ span: "strip" }, { width: 1320 * 5, height: 2868 });
      expect(state.slides.length).toBe(5);
      expect(validateProject(state).map((i) => i.code)).not.toContain(
        "background-image-aspect-mismatch",
      );

      const perSlide = withImage({ span: "strip" }); // 1320x2868
      expect(validateProject(perSlide).map((i) => i.code)).toContain(
        "background-image-aspect-mismatch",
      );
    });
  });
});
