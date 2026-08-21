import { describe, expect, it } from "vitest";

import worker from "../worker";

function assetEnv(response: Response) {
  return {
    ASSETS: {
      fetch: async () => response,
    },
  };
}

describe("agent-friendly 404 responses", () => {
  it("returns a Markdown 404 with discovery links when requested", async () => {
    const response = await worker.fetch(
      new Request("https://truepane.dev/not-real", {
        headers: { Accept: "text/markdown" },
      }),
      assetEnv(new Response("<h1>Page not found</h1>", {
        status: 404,
        headers: { "Content-Type": "text/html" },
      })),
    );

    expect(response.status).toBe(404);
    expect(response.headers.get("Content-Type")).toBe("text/markdown; charset=utf-8");
    expect(response.headers.get("Vary")).toBe("Accept");
    await expect(response.text()).resolves.toContain("https://truepane.dev/llms.txt");
  });

  it("preserves the HTML 404 for browser requests", async () => {
    const response = await worker.fetch(
      new Request("https://truepane.dev/not-real", {
        headers: { Accept: "text/html" },
      }),
      assetEnv(new Response("<h1>Page not found</h1>", {
        status: 404,
        headers: {
          "Content-Type": "text/html",
          Vary: "Accept-Encoding",
        },
      })),
    );

    expect(response.status).toBe(404);
    expect(response.headers.get("Content-Type")).toBe("text/html");
    expect(response.headers.get("Vary")).toBe("Accept-Encoding, Accept");
    await expect(response.text()).resolves.toContain("Page not found");
  });

  it("passes valid non-homepage assets through unchanged", async () => {
    const assetResponse = new Response("<h1>Developers</h1>", {
      headers: { "Content-Type": "text/html" },
    });
    const response = await worker.fetch(
      new Request("https://truepane.dev/developers", {
        headers: { Accept: "text/markdown" },
      }),
      assetEnv(assetResponse),
    );

    expect(response).toBe(assetResponse);
    expect(response.status).toBe(200);
    expect(response.headers.get("Vary")).toBeNull();
  });
});

describe("agent discovery", () => {
  it("advertises the machine-readable entry points from the homepage", async () => {
    const response = await worker.fetch(
      new Request("https://truepane.dev/", { headers: { Accept: "text/html" } }),
      assetEnv(new Response("<h1>Truepane</h1>", {
        headers: { "Content-Type": "text/html" },
      })),
    );

    const link = response.headers.get("Link");
    expect(link).toContain('</sitemap.xml>; rel="sitemap"');
    expect(link).toContain('</mcp/server.json>; rel="service-desc"');
    expect(link).toContain('</.well-known/ai-catalog.json>; rel="ai-catalog"');
    expect(link).toContain('</.well-known/agent-skills/index.json>; rel="agent-skills"');
  });

  it("serves the stdio registry metadata from the compatibility well-known path", async () => {
    let requestedUrl = "";
    const response = await worker.fetch(
      new Request("https://truepane.dev/.well-known/mcp"),
      {
        ASSETS: {
          fetch: async (request: Request) => {
            requestedUrl = request.url;
            return new Response('{"name":"io.github.antonkarliner/truepane"}');
          },
        },
      },
    );

    expect(requestedUrl).toBe("https://truepane.dev/mcp/server.json");
    expect(response.headers.get("Content-Type")).toBe("application/json; charset=utf-8");
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });

  it("adds cross-origin discovery headers to published catalog assets", async () => {
    const response = await worker.fetch(
      new Request("https://truepane.dev/.well-known/ai-catalog.json"),
      assetEnv(new Response('{"specVersion":"1.0","entries":[]}')),
    );

    expect(response.headers.get("Content-Type")).toBe("application/ai-catalog+json; charset=utf-8");
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=3600");
  });
});
