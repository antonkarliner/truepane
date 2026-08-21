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
