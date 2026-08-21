import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { STATIC_PAGE_REGISTRY, StaticPage, type StaticPageSlug } from "./StaticPage";

describe("static information pages", () => {
  it("keeps every declared page substantive and independently addressable", () => {
    expect(Object.keys(STATIC_PAGE_REGISTRY)).toEqual(["developers", "about", "privacy", "contact"]);

    for (const slug of Object.keys(STATIC_PAGE_REGISTRY) as StaticPageSlug[]) {
      const html = renderToStaticMarkup(createElement(StaticPage, { slug }));
      expect(html.match(/<h1>/g), `${slug} should have one H1`).toHaveLength(1);
      expect(html.length, `${slug} should contain useful content`).toBeGreaterThan(900);
    }
  });

  it("states the actual local integration and private security channels", () => {
    const developers = renderToStaticMarkup(createElement(StaticPage, { slug: "developers" }));
    const contact = renderToStaticMarkup(createElement(StaticPage, { slug: "contact" }));

    expect(developers).toContain("does not expose a hosted public REST API");
    expect(contact).toContain("/security/advisories/new");
  });
});

describe("MCP publication metadata", () => {
  it("matches the package identity and version before the build publishes a first-party copy", () => {
    const server = JSON.parse(readFileSync("packages/truepane-mcp/server.json", "utf8"));
    const packageMetadata = JSON.parse(readFileSync("packages/truepane-mcp/package.json", "utf8"));

    expect(server.name).toBe(packageMetadata.mcpName);
    expect(server.version).toBe(packageMetadata.version);
    expect(server.packages[0].identifier).toBe(packageMetadata.name);
    expect(server.packages[0].version).toBe(packageMetadata.version);
  });
});
