import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { STATIC_PAGE_REGISTRY, StaticPage, type StaticPageSlug } from "./StaticPage";
import { GUIDE_REGISTRY, GuidePage, type GuideSlug } from "./GuidePage";
import { HYDRATION_THEME } from "./hydrationTheme";

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

  it("matches prerendered light markup on the first hydration render", () => {
    const staticPrerender = renderToStaticMarkup(createElement(StaticPage, { slug: "developers" }));
    const staticHydration = renderToStaticMarkup(createElement(StaticPage, {
      slug: "developers",
      theme: HYDRATION_THEME,
    }));
    const guideSlug = Object.keys(GUIDE_REGISTRY)[0] as GuideSlug;
    const guidePrerender = renderToStaticMarkup(createElement(GuidePage, { slug: guideSlug }));
    const guideHydration = renderToStaticMarkup(createElement(GuidePage, {
      slug: guideSlug,
      theme: HYDRATION_THEME,
    }));

    expect(staticHydration).toBe(staticPrerender);
    expect(guideHydration).toBe(guidePrerender);
    expect(staticHydration).toContain('aria-label="Switch to dark mode"');
    expect(guideHydration).toContain('aria-label="Switch to dark mode"');
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
