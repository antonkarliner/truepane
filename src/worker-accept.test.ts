import { describe, expect, it } from "vitest";

import { appendVary, selectRepresentation } from "../worker/accept";

describe("homepage Accept negotiation", () => {
  it("uses HTML when Accept is absent", () => {
    expect(selectRepresentation(null)).toBe("html");
  });

  it("selects Markdown when it is preferred", () => {
    expect(selectRepresentation("text/markdown, text/html;q=0.5")).toBe("markdown");
  });

  it("selects HTML when its q-value is higher", () => {
    expect(selectRepresentation("text/html, text/markdown;q=0.5")).toBe("html");
  });

  it("uses the HTML default for a wildcard fallback", () => {
    expect(selectRepresentation("*/*")).toBe("html");
  });

  it("honors a specific Markdown q=0 rejection", () => {
    expect(selectRepresentation("text/*;q=0.8, text/markdown;q=0")).toBe("html");
  });

  it("returns no representation when both are rejected", () => {
    expect(selectRepresentation("text/html;q=0, text/markdown;q=0")).toBeNull();
  });

  it("uses client order when quality and specificity are equal", () => {
    expect(selectRepresentation("text/markdown, text/html")).toBe("markdown");
  });
});

describe("Vary preservation", () => {
  it("adds Accept without dropping or duplicating existing values", () => {
    const headers = new Headers({ Vary: "Accept-Encoding" });
    appendVary(headers, "Accept");
    appendVary(headers, "accept");
    expect(headers.get("Vary")).toBe("Accept-Encoding, Accept");
  });
});
