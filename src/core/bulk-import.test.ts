import { describe, expect, it } from "vitest";
import { bulkSlotKey, mapBulkImport } from "./bulk-import";

const inventory = {
  slideCount: 3,
  targets: ["ios", "ipad", "android", "android-tablet"],
  languages: ["fr", "de"],
};

describe("bulk screenshot mapping", () => {
  it("maps explicit target/locale paths deterministically", () => {
    const result = mapBulkImport([
      { id: "b", name: "ios/fr/02-detail.png", width: 1, height: 1 },
      { id: "a", name: "ios/source/01-home.png", width: 1, height: 1 },
    ], inventory);
    expect(result.assignments.map((item) => item.file.id)).toEqual(["b", "a"]);
    expect(result.assignments[0].slot).toEqual({ slideIndex: 1, target: "ios", language: "fr" });
    expect(result.assignments[1].reason).toBe("explicit-path");
  });

  it("uses dimensions and filename tokens without guessing ambiguous files", () => {
    const result = mapBulkImport([
      { id: "1", name: "01-home.png", width: 1080, height: 2400 },
      { id: "2", name: "02-home.png", width: 999, height: 999 },
    ], inventory);
    expect(result.assignments[0].slot.target).toBe("android");
    expect(result.unmapped[0].reason).toBe("ambiguous-target");
  });

  it("reports duplicate and occupied slots without overwriting", () => {
    const occupied = new Set([bulkSlotKey({ slideIndex: 0, target: "ios", language: "" })]);
    const result = mapBulkImport([
      { id: "1", name: "ios/source/01-a.png", width: 1, height: 1 },
      { id: "2", name: "ios/source/01-b.png", width: 1, height: 1 },
    ], { ...inventory, occupied });
    expect(result.assignments.map((item) => item.conflict)).toEqual(["occupied-slot", "duplicate-slot"]);
  });

  it("keeps unknown locales, bad extensions, and out-of-range slides unmapped", () => {
    const result = mapBulkImport([
      { id: "1", name: "ios/es/01-a.png", width: 1, height: 1 },
      { id: "2", name: "ios/source/01-a.gif", width: 1, height: 1 },
      { id: "3", name: "ios/source/09-a.png", width: 1, height: 1 },
    ], inventory);
    expect(result.unmapped.map((item) => item.reason)).toEqual([
      "unknown-locale",
      "bad-extension",
      "slide-out-of-range",
    ]);
  });
});
