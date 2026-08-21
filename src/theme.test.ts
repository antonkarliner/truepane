import { afterEach, describe, expect, it } from "vitest";

import { HYDRATION_THEME } from "./hydrationTheme";
import { initialTheme } from "./theme";

const originalDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
const originalLocalStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");

function restoreGlobal(name: "document" | "localStorage" | "window", descriptor: PropertyDescriptor | undefined) {
  if (descriptor) Object.defineProperty(globalThis, name, descriptor);
  else Reflect.deleteProperty(globalThis, name);
}

afterEach(() => {
  restoreGlobal("document", originalDocument);
  restoreGlobal("localStorage", originalLocalStorage);
  restoreGlobal("window", originalWindow);
});

describe("direct-load theme hydration", () => {
  it("starts from prerendered light and resolves a persisted dark preference afterward", () => {
    const dataset: Record<string, string> = {};
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: {
        documentElement: { dataset },
        querySelector: () => null,
      },
    });
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        getItem: () => "dark",
        setItem: () => undefined,
      },
    });
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { matchMedia: () => ({ matches: false }) },
    });

    expect(HYDRATION_THEME).toBe("light");
    expect(initialTheme()).toBe("dark");
    expect(dataset.theme).toBe("dark");
  });
});
