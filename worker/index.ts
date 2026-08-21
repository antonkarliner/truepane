import { appendVary, selectRepresentation } from "./accept";

type Env = {
  ASSETS: { fetch(request: Request): Promise<Response> };
};

const HOMEPAGE_LINKS = [
  '</llms.txt>; rel="alternate"; type="text/markdown"',
  '</index.md>; rel="alternate"; type="text/markdown"',
  '</sitemap.xml>; rel="sitemap"; type="application/xml"',
  '</developers>; rel="describedby"; type="text/html"',
  '</mcp/server.json>; rel="service-desc"; type="application/json"',
  '</.well-known/ai-catalog.json>; rel="ai-catalog"; type="application/ai-catalog+json"',
  '</.well-known/agent-skills/index.json>; rel="agent-skills"; type="application/json"',
].join(", ");

const DISCOVERY_CONTENT_TYPES = new Map<string, string>([
  ["/.well-known/ai-catalog.json", "application/ai-catalog+json; charset=utf-8"],
  ["/.well-known/agent-skills/index.json", "application/json; charset=utf-8"],
  ["/.well-known/mcp", "application/json; charset=utf-8"],
  ["/.well-known/mcp.json", "application/json; charset=utf-8"],
  ["/index.md", "text/markdown; charset=utf-8"],
]);

function withVaryAccept(response: Response): Response {
  const headers = new Headers(response.headers);
  appendVary(headers, "Accept");

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function withHomepageHeaders(response: Response, representation: "html" | "markdown"): Response {
  const headers = new Headers(response.headers);
  appendVary(headers, "Accept");

  if (representation === "markdown") {
    headers.set("Content-Type", "text/markdown; charset=utf-8");
  } else {
    const existingLink = headers.get("Link");
    headers.set("Link", existingLink ? `${existingLink}, ${HOMEPAGE_LINKS}` : HOMEPAGE_LINKS);
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function withDiscoveryHeaders(response: Response, contentType: string | undefined): Response {
  const headers = new Headers(response.headers);
  headers.set("Access-Control-Allow-Origin", "*");
  headers.set("Cache-Control", "public, max-age=3600");
  if (contentType) headers.set("Content-Type", contentType);

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function markdownNotFound(request: Request): Response {
  const origin = new URL(request.url).origin;
  const body = [
    "# Truepane page not found",
    "",
    "The requested path does not exist.",
    "",
    `- [Developer resources](${origin}/developers)`,
    `- [llms.txt](${origin}/llms.txt)`,
    `- [Sitemap](${origin}/sitemap.xml)`,
    "",
  ].join("\n");
  const headers = new Headers({ "Content-Type": "text/markdown; charset=utf-8" });
  appendVary(headers, "Accept");
  return new Response(body, { status: 404, headers });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname !== "/") {
      const assetRequest = url.pathname === "/.well-known/mcp"
        ? new Request(new URL("/mcp/server.json", request.url), {
            method: request.method,
            headers: request.headers,
          })
        : request;
      const assetResponse = await env.ASSETS.fetch(assetRequest);
      const contentType = DISCOVERY_CONTENT_TYPES.get(url.pathname)
        ?? (url.pathname.startsWith("/.well-known/agent-skills/") && url.pathname.endsWith("/SKILL.md")
          ? "text/markdown; charset=utf-8"
          : undefined);
      if (assetResponse.status !== 404 && contentType) {
        return withDiscoveryHeaders(assetResponse, contentType);
      }
      if (assetResponse.status !== 404) return assetResponse;

      if (selectRepresentation(request.headers.get("Accept")) === "markdown") {
        return markdownNotFound(request);
      }
      return withVaryAccept(assetResponse);
    }

    const representation = selectRepresentation(request.headers.get("Accept"));
    if (!representation) {
      const headers = new Headers({ "Content-Type": "text/plain; charset=utf-8" });
      appendVary(headers, "Accept");
      return new Response("No acceptable Truepane representation is available.\n", {
        status: 406,
        headers,
      });
    }

    if (representation === "markdown") {
      const markdownUrl = new URL("/llms.txt", request.url);
      return withHomepageHeaders(await env.ASSETS.fetch(new Request(markdownUrl, request)), "markdown");
    }

    return withHomepageHeaders(await env.ASSETS.fetch(request), "html");
  },
};
