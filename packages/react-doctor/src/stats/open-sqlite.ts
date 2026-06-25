import { createRequire } from "node:module";

const nodeRequire = createRequire(import.meta.url);

/** Minimal read surface over a `node:sqlite` database (prepared statements). */
export interface ReadOnlySqliteDatabase {
  prepare(sql: string): {
    get(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown[];
  };
  close(): void;
}

// A read-only `file:` URI with `immutable=1`. A running editor (Cursor/VSCode)
// holds its SQLite store locked, so a plain read-only connection opens but then
// throws "database is locked" on first read; `immutable=1` tells SQLite the file
// won't change and skips all locking, reading the live database (it ignores any
// uncommitted WAL, which is fine for a history scan). Forward-slashed + encoded
// for the URI grammar so paths with spaces (e.g. "Cursor Nightly") parse.
const toImmutableFileUri = (databasePath: string): string => {
  const forwardSlashed = databasePath.replace(/\\/g, "/");
  const absolute = forwardSlashed.startsWith("/") ? forwardSlashed : `/${forwardSlashed}`;
  // Encode each segment so reserved URI characters (`?`, `#`, …) inside a path
  // can't be parsed as the query/fragment delimiter; the `/` separators stay.
  const encoded = absolute.split("/").map(encodeURIComponent).join("/");
  return `file:${encoded}?immutable=1`;
};

/**
 * Open a SQLite database read-only via the built-in `node:sqlite`, or `null`
 * when it is unavailable (Node < 22.13, where the require throws) or the file
 * cannot be read. A plain read-only open is tried first (it sees the WAL, so
 * historical stores read accurately); if its probe trips the lock a running
 * editor holds, an `immutable` open takes over. Shared by the Cursor GUI
 * composer database and the Cursor CLI per-session store.
 */
export const openReadOnlySqlite = (databasePath: string): ReadOnlySqliteDatabase | null => {
  let DatabaseSync: new (
    location: string,
    options: { readOnly: boolean },
  ) => ReadOnlySqliteDatabase;
  try {
    ({ DatabaseSync } = nodeRequire("node:sqlite"));
  } catch {
    return null;
  }
  const locations = [databasePath, toImmutableFileUri(databasePath)];
  for (const location of locations) {
    let database: ReadOnlySqliteDatabase | undefined;
    try {
      database = new DatabaseSync(location, { readOnly: true });
      // A read-only open succeeds even against a locked database; the lock only
      // surfaces on the first page read. Probe with a schema read so a locked
      // store falls through to the immutable strategy instead of throwing later.
      database.prepare("SELECT name FROM sqlite_master LIMIT 1").get();
      return database;
    } catch {
      try {
        database?.close();
      } catch {
        // Nothing to release.
      }
    }
  }
  return null;
};
