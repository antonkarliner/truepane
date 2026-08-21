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

  it("rejects Markdown when its requested charset is incompatible", () => {
    expect(selectRepresentation("text/markdown;charset=iso-8859-1")).toBeNull();
  });

  it("accepts Markdown with a compatible UTF-8 charset parameter", () => {
    expect(selectRepresentation('text/markdown;charset="UTF-8"')).toBe("markdown");
  });

  it("returns no representation when both are rejected", () => {
    expect(selectRepresentation("text/html;q=0, text/markdown;q=0")).toBeNull();
  });

  it("uses client order when quality and specificity are equal", () => {
    expect(selectRepresentation("text/markdown, text/html")).toBe("markdown");
  });

  it("prefers the representation with the more specific matching media parameters", () => {
    expect(selectRepresentation("text/html;q=0.8, text/markdown;charset=utf-8;q=0.8")).toBe("markdown");
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
