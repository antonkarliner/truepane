import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { dataUrlToBlob, deleteAssets, getAsset, listAssetIds, putAsset } from "./assets";

const blobOf = (body: string) => new Blob([body], { type: "image/png" });

describe("asset store", () => {
  // One pass over the whole adapter: content addressing, dedupe, read-back and
  // delete. The document layer above is pure and tested separately; this covers
  // the IndexedDB plumbing so glue bugs cannot hide behind it.
  it("puts, dedupes, reads back and deletes", async () => {
    const id = await putAsset(blobOf("screenshot-alpha"));
    const same = await putAsset(blobOf("screenshot-alpha"));
    const other = await putAsset(blobOf("screenshot-beta"));

    expect(same).toBe(id);
    expect(other).not.toBe(id);
    expect((await listAssetIds()).sort()).toEqual([id, other].sort());

    expect(await (await getAsset(id))?.text()).toBe("screenshot-alpha");
    expect(await getAsset("missing")).toBeNull();

    await deleteAssets([id]);
    expect(await getAsset(id)).toBeNull();
    expect(await listAssetIds()).toEqual([other]);
  });
});

describe("dataUrlToBlob", () => {
  // The id is a hash of these bytes, so a decoding bug silently changes every
  // asset id and orphans the whole store.
  it("decodes base64 payloads to the original bytes", async () => {
    const blob = dataUrlToBlob(`data:image/png;base64,${btoa("screenshot-alpha")}`);
    expect(blob.type).toBe("image/png");
    expect(await blob.text()).toBe("screenshot-alpha");
  });

  it("rejects a string that is not a data URL", () => {
    expect(() => dataUrlToBlob("https://example.com/a.png")).toThrow();
  });
});
