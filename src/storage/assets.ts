// Browser-only IndexedDB asset store: large binaries (screenshots, custom
// fonts) keyed by a content hash, so the document can reference them by id
// instead of embedding megabytes of base64 in localStorage.
//
// Nothing under src/core/* may import this module — core is shared verbatim
// with the Node MCP server, which has no IndexedDB.

const DB_NAME = "truepane";
const DB_VERSION = 1;
export const ASSET_STORE = "assets";
export const DOCUMENT_STORE = "documents";

// 128 bits of SHA-256. Long enough that a collision between two screenshots is
// not a thing that happens; short enough to keep documents readable.
const ID_LENGTH = 32;

// Stored as a raw ArrayBuffer, not a Blob, deliberately.
//
// WebKit implements Blob-in-IndexedDB by writing the blob out to a temporary
// file and storing a reference to it, which has a long history of failing:
// blobs cannot be stored at all in iOS private browsing (WebKit #198278), and
// "Error preparing blob/file" is a recurring report elsewhere. ArrayBuffer is
// structured-cloned directly into the record with no file machinery involved,
// and is reliable across Chrome, Firefox, and Safari. The public API still
// speaks Blob — only the on-disk representation changed.
interface AssetRecord {
  bytes: ArrayBuffer;
  size: number;
  type: string;
}

let dbPromise: Promise<IDBDatabase> | null = null;

/** Opens (and on first use creates) the shared `truepane` database. */
export function openDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      if (typeof indexedDB === "undefined") {
        reject(new Error("IndexedDB is unavailable"));
        return;
      }
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(ASSET_STORE)) db.createObjectStore(ASSET_STORE);
        if (!db.objectStoreNames.contains(DOCUMENT_STORE)) db.createObjectStore(DOCUMENT_STORE);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    // A failed open must not be cached as the permanent answer.
    dbPromise.catch(() => {
      dbPromise = null;
    });
  }
  return dbPromise;
}

/** Drops the memoized connection so a test can swap in a fresh IDBFactory.
 * Not used by the app — `openDb` is memoized for the life of the page. */
export function resetDbForTests(): void {
  dbPromise = null;
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function txDone(transaction: IDBTransaction): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

/** Content id for a blob: the hex SHA-256 of its bytes, truncated. */
export async function assetId(bytes: Blob): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await bytes.arrayBuffer());
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, ID_LENGTH);
}

/**
 * Stores a blob under its content id and returns that id. Content already
 * present is not rewritten — this is where deduplication happens, and spanned
 * devices plus locale fallbacks lean on it heavily.
 */
export async function putAsset(bytes: Blob): Promise<string> {
  const id = await assetId(bytes);
  // Hash and decode BEFORE opening the transaction. An await between the
  // getKey below and its put would let the transaction auto-commit first and
  // the write would silently vanish.
  const buffer = await bytes.arrayBuffer();
  const type = bytes.type;
  const db = await openDb();
  const transaction = db.transaction(ASSET_STORE, "readwrite");
  const store = transaction.objectStore(ASSET_STORE);
  const existing = await requestResult(store.getKey(id));
  if (existing === undefined) {
    const record: AssetRecord = { bytes: buffer, size: buffer.byteLength, type };
    store.put(record, id);
  }
  await txDone(transaction);
  return id;
}

export async function getAsset(id: string): Promise<Blob | null> {
  const db = await openDb();
  const store = db.transaction(ASSET_STORE, "readonly").objectStore(ASSET_STORE);
  const record = (await requestResult(store.get(id))) as AssetRecord | undefined;
  if (!record) return null;
  // Records written before the Blob → ArrayBuffer change still read back.
  const legacy = (record as unknown as { blob?: Blob }).blob;
  if (legacy) return legacy;
  return new Blob([record.bytes], { type: record.type });
}

export async function deleteAssets(ids: string[]): Promise<void> {
  if (!ids.length) return;
  const db = await openDb();
  const transaction = db.transaction(ASSET_STORE, "readwrite");
  const store = transaction.objectStore(ASSET_STORE);
  for (const id of ids) store.delete(id);
  await txDone(transaction);
}

export async function listAssetIds(): Promise<string[]> {
  const db = await openDb();
  const store = db.transaction(ASSET_STORE, "readonly").objectStore(ASSET_STORE);
  const keys = await requestResult(store.getAllKeys());
  return keys.map(String);
}

/** Reads a JSON document (project, brand kits, migration marker) by key. */
export async function getDocument<T>(key: string): Promise<T | null> {
  const db = await openDb();
  const store = db.transaction(DOCUMENT_STORE, "readonly").objectStore(DOCUMENT_STORE);
  return ((await requestResult(store.get(key))) as T | undefined) ?? null;
}

export async function putDocument(key: string, value: unknown): Promise<void> {
  const db = await openDb();
  const transaction = db.transaction(DOCUMENT_STORE, "readwrite");
  transaction.objectStore(DOCUMENT_STORE).put(value, key);
  await txDone(transaction);
}

/** Re-encodes a stored blob as a data URL for the render path. */
export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
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
