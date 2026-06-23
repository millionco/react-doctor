import { asRecord } from "./coerce.js";
import { openReadOnlySqlite } from "./open-sqlite.js";

// The Cursor CLI agent (`~/.cursor` / `~/.cursor-nightly`) stores each chat as
// its own content-addressed SQLite store, distinct from the GUI's single
// `state.vscdb`. The `meta` table holds one row whose `value` is hex-encoded
// JSON (the latest root blob id + last-used model); the `blobs` table maps a
// sha256 id to either a message (JSON: `{ role, content }`) or the binary root
// manifest. The manifest is a protobuf-style flat list of `0x0a 0x20` followed
// by a 32-byte blob id, giving the conversation's messages in order.

export interface CursorCliMessage {
  readonly role: string;
  readonly content: unknown;
}

export interface CursorCliStore {
  readonly lastUsedModel: string | null;
  readonly messages: CursorCliMessage[];
}

const MANIFEST_RECORD_TAG = 0x0a;
const MANIFEST_ID_LENGTH = 0x20;
const MANIFEST_RECORD_LENGTH = 2 + MANIFEST_ID_LENGTH;

/**
 * The conversation's message blob ids, in order, read from the leading run of
 * `[0x0a, 0x20, <32-byte id>]` records. Trailing protobuf fields after the run
 * are ignored; a manifest that doesn't start with the run yields `[]`.
 */
const parseManifestBlobIds = (manifest: Buffer): string[] => {
  const ids: string[] = [];
  let offset = 0;
  while (
    offset + MANIFEST_RECORD_LENGTH <= manifest.length &&
    manifest[offset] === MANIFEST_RECORD_TAG &&
    manifest[offset + 1] === MANIFEST_ID_LENGTH
  ) {
    ids.push(manifest.subarray(offset + 2, offset + MANIFEST_RECORD_LENGTH).toString("hex"));
    offset += MANIFEST_RECORD_LENGTH;
  }
  return ids;
};

/** blobs.data is a BLOB (Uint8Array); meta.value is hex-encoded TEXT. */
const toBuffer = (value: unknown): Buffer | null => {
  if (value instanceof Uint8Array) return Buffer.from(value);
  if (typeof value === "string") return Buffer.from(value, "hex");
  return null;
};

/**
 * Read a Cursor CLI per-session `store.db`: the last-used model and every
 * conversation message in order. Returns `null` when the store can't be opened
 * (older Node without `node:sqlite`, or an unreadable/locked file) or has no
 * usable `meta` row; the messages array is empty when the manifest is missing.
 */
export const readCursorCliStore = (storeDbPath: string): CursorCliStore | null => {
  const database = openReadOnlySqlite(storeDbPath);
  if (!database) return null;
  try {
    const metaRow = asRecord(database.prepare("SELECT value FROM meta LIMIT 1").get());
    const metaValue = metaRow && typeof metaRow.value === "string" ? metaRow.value : null;
    if (!metaValue) return null;
    let meta: Record<string, unknown> | undefined;
    try {
      meta = asRecord(JSON.parse(Buffer.from(metaValue, "hex").toString("utf8")));
    } catch {
      return null;
    }
    if (!meta) return null;

    const lastUsedModel = typeof meta.lastUsedModel === "string" ? meta.lastUsedModel : null;
    const latestRootBlobId =
      typeof meta.latestRootBlobId === "string" ? meta.latestRootBlobId : null;
    if (!latestRootBlobId) return { lastUsedModel, messages: [] };

    const blobStatement = database.prepare("SELECT data FROM blobs WHERE id = ?");
    const blobBuffer = (id: string): Buffer | null => {
      const row = asRecord(blobStatement.get(id));
      return row ? toBuffer(row.data) : null;
    };

    const manifest = blobBuffer(latestRootBlobId);
    if (!manifest) return { lastUsedModel, messages: [] };

    const messages: CursorCliMessage[] = [];
    for (const blobId of parseManifestBlobIds(manifest)) {
      const raw = blobBuffer(blobId);
      if (!raw) continue;
      const text = raw.toString("utf8");
      if (!text.startsWith("{")) continue;
      let message: Record<string, unknown> | undefined;
      try {
        message = asRecord(JSON.parse(text));
      } catch {
        continue;
      }
      if (message && typeof message.role === "string") {
        messages.push({ role: message.role, content: message.content });
      }
    }
    return { lastUsedModel, messages };
  } catch {
    // A locked or unreadable store can throw mid-read; skip it rather than
    // sinking the whole stats run.
    return null;
  } finally {
    try {
      database.close();
    } catch {
      // Already closed or never fully opened — nothing to release.
    }
  }
};
