import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { createHash } from "node:crypto";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { cloudflare } from "@cloudflare/vite-plugin";
import { GUIDE_REGISTRY, GuidePage, type GuideSlug } from "./src/GuidePage";
import { STATIC_PAGE_REGISTRY, StaticPage, type StaticPageSlug } from "./src/StaticPage";

const SEO_TITLE = "Truepane - App Store Screenshot Generator for Indie Apps";
const SEO_DESCRIPTION =
  "Create App Store and Google Play screenshots in your browser with device frames, your own background images or generated ones, local canvas rendering, and PNG, strip, or ZIP export.";
const DEFAULT_SITE_URL = "https://truepane.dev";
const AGENT_SKILL_NAME = "truepane-screenshot-workflow";
const AGENT_SKILL_SOURCE = `skills/${AGENT_SKILL_NAME}/SKILL.md`;
const GUIDE_SLUGS = Object.keys(GUIDE_REGISTRY) as GuideSlug[];
const STATIC_PAGE_SLUGS = Object.keys(STATIC_PAGE_REGISTRY) as StaticPageSlug[];

function normalizeSiteUrl(raw: string | undefined): string | null {
  const value = raw?.trim().replace(/\/+$/, "");
  if (!value) return null;
  if (!/^https?:\/\/[^\s/$.?#].[^\s]*$/i.test(value)) return null;
  return value;
}

function jsonLd(siteUrl: string | null): string {
  const software: Record<string, unknown> = {
    "@type": "SoftwareApplication",
    name: "Truepane",
    applicationCategory: "DesignApplication",
    operatingSystem: "Any modern browser",
    headline: SEO_TITLE,
    description: SEO_DESCRIPTION,
    author: { "@type": "Person", name: "Anton Karliner" },
    maintainer: { "@type": "Person", name: "Anton Karliner" },
    codeRepository: "https://github.com/antonkarliner/truepane",
    sameAs: [
      "https://github.com/antonkarliner/truepane",
      "https://www.npmjs.com/package/truepane-mcp",
    ],
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
    featureList: [
      "App Store and Google Play screenshot generation",
      "iPhone, iPad, Android phone, and Android tablet frames",
      "Local browser canvas rendering",
      "PNG, horizontal strip, ZIP, and JSON project export",
      "Optional AI prompt helper for background and palette settings",
      "MCP server (truepane-mcp) for AI agents to generate screenshots",
    ],
  };
  if (siteUrl) {
    software.url = siteUrl;
    software.image = `${siteUrl}/og-image.png`;
  }

  return JSON.stringify(
    {
      "@context": "https://schema.org",
      "@graph": [
        software,
        {
          "@type": "FAQPage",
          mainEntity: [
            {
              "@type": "Question",
              name: "What is Truepane?",
              acceptedAnswer: {
                "@type": "Answer",
                text: "Truepane is a browser app for making App Store and Google Play screenshot sets with device frames, text overlays, generated backgrounds, and export tools.",
              },
            },
            {
              "@type": "Question",
              name: "Does Truepane upload my app screenshots?",
              acceptedAnswer: {
                "@type": "Answer",
                text: "No. Screenshot composition happens locally on canvas in your browser. The optional AI style helper only sends the text prompt when that feature is configured and used.",
              },
            },
            {
              "@type": "Question",
              name: "Can I export screenshots for both App Store and Google Play?",
              acceptedAnswer: {
                "@type": "Answer",
                text: "Yes. Truepane includes Apple and Android device formats and exports slide PNGs, horizontal strips, ZIP files, and JSON project backups.",
              },
            },
          ],
        },
      ],
    },
    null,
    2,
  ).replace(/</g, "\\u003c");
}

function aiCatalog(siteUrl: string, version: string): string {
  return `${JSON.stringify({
    specVersion: "1.0",
    host: {
      displayName: "Truepane",
      identifier: `${siteUrl}/`,
    },
    entries: [
      {
        identifier: "urn:air:truepane.dev:mcp:truepane-mcp",
        displayName: "Truepane MCP",
        version,
        type: "application/json",
        url: `${siteUrl}/mcp/server.json`,
        description: "Registry metadata for the local Truepane stdio MCP server.",
        tags: ["mcp", "app-store", "google-play", "screenshots"],
      },
      {
        identifier: `urn:air:truepane.dev:skill:${AGENT_SKILL_NAME}`,
        displayName: "Truepane screenshot workflow",
        type: "application/agent-skills+md",
        url: `${siteUrl}/.well-known/agent-skills/${AGENT_SKILL_NAME}/SKILL.md`,
        description: "Agent instructions for creating and validating store screenshot sets with Truepane.",
        tags: ["agent-skill", "app-store", "google-play", "screenshots"],
      },
    ],
  }, null, 2)}\n`;
}

function agentSkillsIndex(siteUrl: string, skillSource: string): string {
  const digest = createHash("sha256").update(skillSource).digest("hex");
  return `${JSON.stringify({
    $schema: "https://schemas.agentskills.io/discovery/0.2.0/schema.json",
    skills: [
      {
        name: AGENT_SKILL_NAME,
        type: "skill-md",
        description: "Create, localize, validate, and render App Store or Google Play screenshot sets with the local Truepane MCP server.",
        url: `${siteUrl}/.well-known/agent-skills/${AGENT_SKILL_NAME}/SKILL.md`,
        digest: `sha256:${digest}`,
      },
    ],
  }, null, 2)}\n`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

const HOME_CONTENT_START = "<!-- truepane:home-content:start -->";
const HOME_CONTENT_END = "<!-- truepane:home-content:end -->";

function withoutHomeContent(html: string): string {
  const start = html.indexOf(HOME_CONTENT_START);
  const end = html.indexOf(HOME_CONTENT_END);
  if (start === -1 || end === -1 || end < start) {
    throw new Error("Home-only content markers are missing or out of order");
  }
  return html.slice(0, start) + html.slice(end + HOME_CONTENT_END.length);
}

function assertSingleH1(html: string, route: string): void {
  const h1Count = html.match(/<h1(?:\s|>)/g)?.length ?? 0;
  if (h1Count !== 1) {
    throw new Error(`${route} must contain exactly one raw H1; found ${h1Count}`);
  }
}

function prerenderGuide(indexHtml: string, slug: GuideSlug, siteUrl: string): string {
  const guide = GUIDE_REGISTRY[slug];
  const route = `/guides/${slug}`;
  const canonical = `${siteUrl}${route}`;
  const socialImage = `${siteUrl}/og/guides/${slug}.png`;
  const socialImageAlt = `${guide.title.replace(/ · Truepane$/, "")} — Truepane guide`;
  const article = renderToStaticMarkup(createElement(GuidePage, { slug }));

  return withoutHomeContent(indexHtml
    .replace(/<title>.*?<\/title>/s, `<title>${escapeHtml(guide.title)}</title>`)
    .replace(
      /<meta name="description" content="[^"]*" \/>/,
      `<meta name="description" content="${escapeHtml(guide.description)}" />`,
    )
    .replace(
      /<meta property="og:title" content="[^"]*" \/>/,
      `<meta property="og:title" content="${escapeHtml(guide.title)}" />`,
    )
    .replace(
      /<meta property="og:description" content="[^"]*" \/>/,
      `<meta property="og:description" content="${escapeHtml(guide.description)}" />`,
    )
    .replace(
      /<meta property="og:image" content="[^"]*" \/>/,
      `<meta property="og:image" content="${escapeHtml(socialImage)}" />`,
    )
    .replace(
      /<meta property="og:image:alt" content="[^"]*" \/>/,
      `<meta property="og:image:alt" content="${escapeHtml(socialImageAlt)}" />`,
    )
    .replace(
      /<meta name="twitter:title" content="[^"]*" \/>/,
      `<meta name="twitter:title" content="${escapeHtml(guide.title)}" />`,
    )
    .replace(
      /<meta name="twitter:description" content="[^"]*" \/>/,
      `<meta name="twitter:description" content="${escapeHtml(guide.description)}" />`,
    )
    .replace(
      /<meta name="twitter:image" content="[^"]*" \/>/,
      `<meta name="twitter:image" content="${escapeHtml(socialImage)}" />`,
    )
    .replace(
      /<meta name="twitter:image:alt" content="[^"]*" \/>/,
      `<meta name="twitter:image:alt" content="${escapeHtml(socialImageAlt)}" />`,
    )
    .replace(
      /<link rel="canonical" href="[^"]*" \/>/,
      `<link rel="canonical" href="${escapeHtml(canonical)}" />`,
    )
    .replace(
      /<meta property="og:url" content="[^"]*" \/>/,
      `<meta property="og:url" content="${escapeHtml(canonical)}" />`,
    )
    .replace("<body>", '<body data-route="guide">')
    .replace('<div id="root"></div>', `<div id="root">${article}</div>`));
}

function prerenderEditor(indexHtml: string, siteUrl: string): string {
  const title = "Truepane editor · App Store screenshot generator";
  const description = "Compose and export App Store and Google Play screenshot sets locally in the Truepane editor.";
  const canonical = `${siteUrl}/editor`;

  return withoutHomeContent(indexHtml
    .replace(/<title>.*?<\/title>/s, `<title>${title}</title>`)
    .replace(
      /<meta name="description" content="[^"]*" \/>/,
      `<meta name="description" content="${description}" />`,
    )
    .replace(
      /<link rel="canonical" href="[^"]*" \/>/,
      `<link rel="canonical" href="${canonical}" />`,
    )
    .replace(
      /<meta property="og:url" content="[^"]*" \/>/,
      `<meta property="og:url" content="${canonical}" />`,
    )
    .replace("<body>", '<body data-route="editor">'));
}

function prerenderStaticPage(indexHtml: string, slug: StaticPageSlug, siteUrl: string): string {
  const page = STATIC_PAGE_REGISTRY[slug];
  const canonical = `${siteUrl}/${slug}`;
  const article = renderToStaticMarkup(createElement(StaticPage, { slug }));

  return withoutHomeContent(indexHtml
    .replace(/<title>.*?<\/title>/s, `<title>${escapeHtml(page.title)}</title>`)
    .replace(
      /<meta name="description" content="[^"]*" \/>/,
      `<meta name="description" content="${escapeHtml(page.description)}" />`,
    )
    .replace(
      /<meta property="og:title" content="[^"]*" \/>/,
      `<meta property="og:title" content="${escapeHtml(page.title)}" />`,
    )
    .replace(
      /<meta property="og:description" content="[^"]*" \/>/,
      `<meta property="og:description" content="${escapeHtml(page.description)}" />`,
    )
    .replace(
      /<meta name="twitter:title" content="[^"]*" \/>/,
      `<meta name="twitter:title" content="${escapeHtml(page.title)}" />`,
    )
    .replace(
      /<meta name="twitter:description" content="[^"]*" \/>/,
      `<meta name="twitter:description" content="${escapeHtml(page.description)}" />`,
    )
    .replace(
      /<link rel="canonical" href="[^"]*" \/>/,
      `<link rel="canonical" href="${escapeHtml(canonical)}" />`,
    )
    .replace(
      /<meta property="og:url" content="[^"]*" \/>/,
      `<meta property="og:url" content="${escapeHtml(canonical)}" />`,
    )
    .replace("<body>", '<body data-route="static">')
    .replace('<div id="root"></div>', `<div id="root">${article}</div>`));
}

function truepaneSeo(siteUrl: string | null, isBuild: boolean): Plugin {
  return {
    name: "truepane-seo",
    applyToEnvironment(environment) {
      return environment.name === "client";
    },
    buildStart() {
      if (isBuild && !siteUrl) {
        this.warn("VITE_PUBLIC_SITE_URL is unset or invalid; omitting canonical, robots.txt, and sitemap.xml.");
      }
    },
    transformIndexHtml(html) {
      const originTags = siteUrl
        ? [
            `<link rel="canonical" href="${siteUrl}/" />`,
            `<meta property="og:url" content="${siteUrl}/" />`,
            `<meta property="og:image" content="${siteUrl}/og-image.png" />`,
            `<meta property="og:image:type" content="image/png" />`,
            `<meta property="og:image:width" content="1200" />`,
            `<meta property="og:image:height" content="630" />`,
            `<meta property="og:image:alt" content="Truepane editor composing a store screenshot set" />`,
            `<meta name="twitter:image" content="${siteUrl}/og-image.png" />`,
            `<meta name="twitter:image:alt" content="Truepane editor composing a store screenshot set" />`,
            `<link rel="ai-catalog" href="${siteUrl}/.well-known/ai-catalog.json" type="application/ai-catalog+json" />`,
            `<link rel="agent-skills" href="${siteUrl}/.well-known/agent-skills/index.json" type="application/json" />`,
          ].join("\n")
        : "";
      return html
        .replace("<!-- truepane:origin-tags -->", originTags)
        .replace(
          "<!-- truepane:structured-data -->",
          `<script type="application/ld+json">${jsonLd(siteUrl)}</script>`,
        );
    },
    generateBundle() {
      if (!siteUrl) return;
      const lastmod = new Date().toISOString().slice(0, 10);
      const sitemapUrls = [
        `${siteUrl}/`,
        ...STATIC_PAGE_SLUGS.map((slug) => `${siteUrl}/${slug}`),
        ...GUIDE_SLUGS.map((slug) => `${siteUrl}/guides/${slug}`),
      ];
      this.emitFile({
        type: "asset",
        fileName: "robots.txt",
        source: `User-agent: *\nAllow: /\nSitemap: ${siteUrl}/sitemap.xml\n`,
      });
      this.emitFile({
        type: "asset",
        fileName: "sitemap.xml",
        source: `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${sitemapUrls.map((url) => `  <url>\n    <loc>${url}</loc>\n    <lastmod>${lastmod}</lastmod>\n  </url>`).join("\n")}\n</urlset>\n`,
      });

    },
    async writeBundle(options) {
      if (!siteUrl || !options.dir) return;
      const indexHtml = await readFile(join(options.dir, "index.html"), "utf8");
      await writeFile(join(options.dir, "editor.html"), prerenderEditor(indexHtml, siteUrl));
      for (const slug of STATIC_PAGE_SLUGS) {
        const pageHtml = prerenderStaticPage(indexHtml, slug, siteUrl);
        assertSingleH1(pageHtml, `/${slug}`);
        await writeFile(join(options.dir, `${slug}.html`), pageHtml);
      }
      const guidesDir = join(options.dir, "guides");
      await mkdir(guidesDir, { recursive: true });
      for (const slug of GUIDE_SLUGS) {
        await writeFile(join(guidesDir, `${slug}.html`), prerenderGuide(indexHtml, slug, siteUrl));
      }

      const serverSource = await readFile("packages/truepane-mcp/server.json", "utf8");
      const server = JSON.parse(serverSource) as {
        name: string;
        version: string;
        packages: Array<{ identifier: string; version: string }>;
      };
      const packageMetadata = JSON.parse(
        await readFile("packages/truepane-mcp/package.json", "utf8"),
      ) as { name: string; version: string; mcpName: string };
      const publishedPackage = server.packages[0];
      if (
        server.name !== packageMetadata.mcpName
        || server.version !== packageMetadata.version
        || publishedPackage?.identifier !== packageMetadata.name
        || publishedPackage.version !== packageMetadata.version
      ) {
        throw new Error("truepane-mcp package.json and server.json metadata are out of sync");
      }
      const mcpDir = join(options.dir, "mcp");
      await mkdir(mcpDir, { recursive: true });
      await writeFile(join(mcpDir, "server.json"), serverSource);

      const skillSource = await readFile(AGENT_SKILL_SOURCE, "utf8");
      const llmsSource = await readFile(join(options.dir, "llms.txt"), "utf8");
      const wellKnownDir = join(options.dir, ".well-known");
      const publishedSkillDir = join(wellKnownDir, "agent-skills", AGENT_SKILL_NAME);
      await mkdir(publishedSkillDir, { recursive: true });
      await Promise.all([
        writeFile(join(wellKnownDir, "ai-catalog.json"), aiCatalog(siteUrl, packageMetadata.version)),
        writeFile(join(wellKnownDir, "mcp"), serverSource),
        writeFile(join(wellKnownDir, "mcp.json"), serverSource),
        writeFile(
          join(wellKnownDir, "agent-skills", "index.json"),
          agentSkillsIndex(siteUrl, skillSource),
        ),
        writeFile(join(publishedSkillDir, "SKILL.md"), skillSource),
        writeFile(join(options.dir, "index.md"), llmsSource),
      ]);

      const requiredArtifacts = [
        "editor.html",
        "404.html",
        "index.md",
        "llms.txt",
        join(".well-known", "ai-catalog.json"),
        join(".well-known", "mcp"),
        join(".well-known", "mcp.json"),
        join(".well-known", "agent-skills", "index.json"),
        join(".well-known", "agent-skills", AGENT_SKILL_NAME, "SKILL.md"),
        join("mcp", "server.json"),
        ...STATIC_PAGE_SLUGS.map((slug) => `${slug}.html`),
        ...GUIDE_SLUGS.map((slug) => join("guides", `${slug}.html`)),
      ];
      await Promise.all(requiredArtifacts.map((file) => access(join(options.dir!, file))));
    },
  };
}

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, ".", "");
  const siteUrl = normalizeSiteUrl(env.VITE_PUBLIC_SITE_URL) ?? DEFAULT_SITE_URL;
  return {
    plugins: [react(), truepaneSeo(siteUrl, command === "build"), cloudflare()],
  };
});
