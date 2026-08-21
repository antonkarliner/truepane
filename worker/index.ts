import { appendVary, selectRepresentation } from "./accept";

type Env = {
  ASSETS: { fetch(request: Request): Promise<Response> };
};

const MARKDOWN_ALTERNATE = '</llms.txt>; rel="alternate"; type="text/markdown"';

function withHeaders(response: Response, representation: "html" | "markdown"): Response {
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

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
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
      return withHeaders(await env.ASSETS.fetch(new Request(markdownUrl, request)), "markdown");
    }

    return withHeaders(await env.ASSETS.fetch(request), "html");
  },
};
