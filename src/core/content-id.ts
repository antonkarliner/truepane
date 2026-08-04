// The content-id contract, shared by the browser asset store and the
// runtime-agnostic background-image importer.
//
// This lives in core rather than in src/storage/assets.ts because core is
// shared verbatim with the Node MCP server, which has no IndexedDB — but both
// sides must agree on one hash. Two implementations would deduplicate against
// each other correctly right up until the day they drifted, and then silently
// store the same bytes twice. src/storage/assets.ts re-exports these so its
// callers keep importing from the storage layer.
//
// Only Web APIs present in both browsers and Node 18+ are used here:
// crypto.subtle, Blob, and atob.

// 128 bits of SHA-256. Long enough that a collision between two screenshots is
// not a thing that happens; short enough to keep documents readable.
const ID_LENGTH = 32;

/** Content id for a blob: the hex SHA-256 of its bytes, truncated. */
export async function assetId(bytes: Blob): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await bytes.arrayBuffer());
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, ID_LENGTH);
}

/**
 * Decodes a `data:` URL into a blob. The document layer holds data URLs (that
 * is what the render path and the exported project format speak); the store
 * holds bytes, which is where the ~33% base64 tax disappears.
 */
export function dataUrlToBlob(dataUrl: string): Blob {
  const comma = dataUrl.indexOf(",");
  if (!dataUrl.startsWith("data:") || comma < 0) {
    throw new Error("not a data URL");
  }
  const header = dataUrl.slice("data:".length, comma);
  const base64 = header.endsWith(";base64");
  const type = (base64 ? header.slice(0, -";base64".length) : header).split(";")[0] || "application/octet-stream";
  const payload = dataUrl.slice(comma + 1);
  if (!base64) return new Blob([decodeURIComponent(payload)], { type });
  const binary = atob(payload);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type });
}
