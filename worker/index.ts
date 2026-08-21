import { appendVary, selectRepresentation } from "./accept";

type Env = {
  ASSETS: { fetch(request: Request): Promise<Response> };
};

const MARKDOWN_ALTERNATE = '</llms.txt>; rel="alternate"; type="text/markdown"';

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
    headers.set("Link", existingLink ? `${existingLink}, ${MARKDOWN_ALTERNATE}` : MARKDOWN_ALTERNATE);
  }

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
      const assetResponse = await env.ASSETS.fetch(request);
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
