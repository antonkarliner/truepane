import * as React from "react";
import { GuideHeader } from "./GuidePage";
import { HYDRATION_THEME } from "./hydrationTheme";

type StaticPageEntry = {
  title: string;
  description: string;
  component: () => React.JSX.Element;
};

function DevelopersPage() {
  return (
    <>
      <p className="guide-eyebrow">Developers · Local MCP</p>
      <h1>Build App Store screenshots with Truepane tools</h1>
      <p className="guide-lead">
        Truepane gives MCP-capable coding agents the same project model and rendering
        engine as the browser editor. The server runs locally over stdio, reads captures
        from paths you provide, and writes projects and rendered assets to local paths.
      </p>
      <h2>Install the local MCP server</h2>
      <p>Use Node.js 18 or newer. Add the published package to Codex:</p>
      <pre><code>codex mcp add truepane -- npx -y truepane-mcp</code></pre>
      <p>Or add it to Claude Code:</p>
      <pre><code>claude mcp add --scope user truepane -- npx -y truepane-mcp</code></pre>
      <p>
        The process starts when your MCP client needs it. It does not require a Truepane
        account or Truepane API key. Truepane does not expose a hosted public REST API.
      </p>
      <h2>What agents can do</h2>
      <p>
        The tools cover project creation, platform and locale setup, deterministic folder
        imports, captions and typography, backgrounds, device composition, brand kits,
        preflight validation, previews, native-size PNG and ZIP exports, custom output
        sizes, and release-baseline comparisons. Start with <code>list_options</code>,
        create or import a project, validate it, render a preview, then review the result
        before producing the full-resolution set.
      </p>
      <h2>Move between an agent and the browser</h2>
      <p>
        The MCP server and browser editor use the same editable Truepane project JSON.
        Export a project from either surface and open it in the other for visual review or
        further automation. Captures and exports stay on the machine running the server;
        nothing is uploaded to Truepane by this workflow.
      </p>
      <h2>Package and protocol metadata</h2>
      <ul>
        <li><a href="/mcp/server.json">First-party MCP server metadata</a></li>
        <li><a href="https://registry.npmjs.org/truepane-mcp/latest">Machine-readable npm package metadata</a></li>
        <li><a href="https://www.npmjs.com/package/truepane-mcp">truepane-mcp on npm</a></li>
        <li><a href="https://github.com/antonkarliner/truepane/tree/main/packages/truepane-mcp">Documentation and source</a></li>
      </ul>
    </>
  );
}

function AboutPage() {
  return (
    <>
      <p className="guide-eyebrow">About Truepane</p>
      <h1>A local-first screenshot workflow for app releases</h1>
      <p className="guide-lead">
        Truepane is a free, open-source project for composing App Store and Google Play
        screenshot sets. It keeps the visual editor and the agent workflow on one portable
        project format, so automation can prepare a release without taking away the final
        visual review.
      </p>
      <h2>Why it exists</h2>
      <p>
        Truepane draws device frames and screenshot layouts procedurally instead of relying
        on a catalog of pre-rendered mockups. That keeps output sharp at native store sizes,
        makes multi-platform and localized projects repeatable, and lets the same rendering
        rules run in a browser or through the local MCP server.
      </p>
      <h2>Open source and maintained in public</h2>
      <p>
        Anton Karliner maintains Truepane as an AGPL-3.0 open-source project. Its source,
        issue history, and contribution activity are available in the
        <a href="https://github.com/antonkarliner/truepane"> public GitHub repository</a>.
        Truepane grew out of the screenshot workflow used for
        <a href="https://timer.coffee"> Timer.Coffee</a>.
      </p>
      <p>
        The project is intentionally local-first: the browser performs image composition
        on canvas, and the MCP server works with files on the user's machine. Hosted AI
        helpers are optional and are not required to design or export screenshots.
      </p>
    </>
  );
}

function PrivacyPage() {
  return (
    <>
      <p className="guide-eyebrow">Privacy</p>
      <h1>What Truepane stores and sends</h1>
      <p className="guide-lead">
        Truepane is a static, local-first editor. Screenshot composition and export happen
        in your browser, and the local MCP server works with files on the machine where it
        runs. The details below describe the current implementation rather than a promise
        about independently hosted forks.
      </p>
      <h2>Projects and screenshots</h2>
      <p>
        The web editor does not upload screenshots to Truepane. It auto-saves project
        documents and content-addressed image assets in your browser's IndexedDB. Where
        IndexedDB is unavailable, the editor uses a localStorage fallback. Project JSON,
        PNG, strip, and ZIP exports are created locally and saved only when you request them.
        Clearing site data removes browser-stored Truepane projects and assets.
      </p>
      <h2>Fonts and site analytics</h2>
      <p>
        Truepane loads Google Fonts from Google's CDN unless you choose a system font or
        upload a font. Those requests disclose ordinary request information such as your IP
        address and browser headers to Google. The public site also loads Umami analytics
        from <code>cloud.umami.is</code> to measure site use. Your screenshots and project
        files are not included in those browser requests by Truepane.
      </p>
      <h2>Optional AI helpers</h2>
      <p>
        The editor remains functional without AI. If you explicitly use an enabled AI
        background or translation helper, Truepane sends the text you submit—and, when you
        supply one, your Groq API key—to the configured Edge Function and model provider.
        The browser does not send screenshot image data as part of those helper requests.
      </p>
      <h2>Local MCP use</h2>
      <p>
        <code>truepane-mcp</code> is a local stdio process. It reads captures from paths an
        agent supplies and writes generated projects and images to local paths. The MCP
        workflow does not require a Truepane account and does not upload those files to a
        Truepane service.
      </p>
      <p>
        Questions about this implementation can be raised through the
        <a href="/contact"> contact channels</a> or checked directly against the
        <a href="https://github.com/antonkarliner/truepane"> source code</a>.
      </p>
    </>
  );
}

function ContactPage() {
  return (
    <>
      <p className="guide-eyebrow">Contact</p>
      <h1>Support and security reports</h1>
      <p className="guide-lead">
        Truepane is maintained in public on GitHub. Use the channel that matches the kind
        of report so ordinary support stays searchable and security details remain private.
      </p>
      <h2>Questions, bugs, and feature requests</h2>
      <p>
        Search or open a <a href="https://github.com/antonkarliner/truepane/issues">GitHub issue</a>
        for setup questions, reproducible bugs, documentation gaps, and feature requests.
        Include the Truepane or <code>truepane-mcp</code> version, your operating system,
        the steps that reproduce the problem, and non-sensitive logs when they are useful.
        Do not include private screenshots, project files, credentials, or vulnerability
        details in a public issue.
      </p>
      <h2>Report a vulnerability privately</h2>
      <p>
        Use the repository's
        <a href="https://github.com/antonkarliner/truepane/security/advisories/new"> private vulnerability report</a>
        form from the GitHub Security tab. That channel creates a private security advisory
        visible to the maintainer, rather than a public issue. Describe the affected version,
        impact, reproduction steps, and any suggested mitigation without publishing an exploit.
      </p>
      <h2>Contributions</h2>
      <p>
        Code and documentation contributions can be proposed through a pull request in the
        <a href="https://github.com/antonkarliner/truepane"> Truepane repository</a>. Review
        the existing project conventions and keep changes focused on the issue being solved.
      </p>
    </>
  );
}

export const STATIC_PAGE_REGISTRY = {
  developers: {
    title: "Truepane developer resources · Local MCP server",
    description: "Set up the local truepane-mcp server, understand its tools and local file behavior, and move editable projects between an agent and the browser.",
    component: DevelopersPage,
  },
  about: {
    title: "About Truepane · Open-source screenshot builder",
    description: "Learn why Truepane is a local-first, open-source App Store and Google Play screenshot workflow and who maintains it.",
    component: AboutPage,
  },
  privacy: {
    title: "Truepane privacy · Local projects and optional services",
    description: "Understand how Truepane stores screenshots and projects locally, loads fonts and analytics, and handles optional AI text requests.",
    component: PrivacyPage,
  },
  contact: {
    title: "Contact Truepane · Support and security reports",
    description: "Use GitHub Issues for Truepane support and the repository's private Security advisory form for vulnerability reports.",
    component: ContactPage,
  },
} satisfies Record<string, StaticPageEntry>;

export type StaticPageSlug = keyof typeof STATIC_PAGE_REGISTRY;

export function StaticPage({
  slug,
  theme = HYDRATION_THEME,
  onToggleTheme = () => undefined,
}: {
  slug: StaticPageSlug;
  theme?: "light" | "dark";
  onToggleTheme?: () => void;
}) {
  const Page = STATIC_PAGE_REGISTRY[slug].component;
  return (
    <div className="guide-page static-page">
      <GuideHeader theme={theme} onToggleTheme={onToggleTheme} />
      <article className="guide-article"><Page /></article>
      <footer className="guide-footer">
        <a href="/">Truepane home</a>
        <a href="/editor">Open Truepane editor →</a>
      </footer>
    </div>
  );
}
