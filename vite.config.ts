import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

import { cloudflare } from "@cloudflare/vite-plugin";

const SEO_TITLE = "Truepane - App Store Screenshot Generator for Indie Apps";
const SEO_DESCRIPTION =
  "Create App Store and Google Play screenshots in your browser with device frames, styled backgrounds, local canvas rendering, and PNG, strip, or ZIP export.";

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

function truepaneSeo(siteUrl: string | null, isBuild: boolean): Plugin {
  return {
    name: "truepane-seo",
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
      this.emitFile({
        type: "asset",
        fileName: "robots.txt",
        source: `User-agent: *\nAllow: /\nSitemap: ${siteUrl}/sitemap.xml\n`,
      });
      this.emitFile({
        type: "asset",
        fileName: "sitemap.xml",
        source: `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url>\n    <loc>${siteUrl}/</loc>\n  </url>\n</urlset>\n`,
      });
    },
  };
}

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, ".", "");
  const siteUrl = normalizeSiteUrl(env.VITE_PUBLIC_SITE_URL);
  return {
    plugins: [react(), truepaneSeo(siteUrl, command === "build"), cloudflare()],
  };
});
