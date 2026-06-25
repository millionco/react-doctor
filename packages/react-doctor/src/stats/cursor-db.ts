import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { asNullableString } from "./coerce.js";
import { openReadOnlySqlite } from "./open-sqlite.js";

// Cursor persists chat state in a single SQLite file. The GUI agent's model
// selection, tool calls (edits), and full post-edit file snapshots all live in
// here — the agent-transcript JSONL files do not record the model at all.
const CURSOR_DB_RELATIVE_PATH = path.join("User", "globalStorage", "state.vscdb");
const COMPOSER_DATA_PREFIX = "composerData:";
const BUBBLE_PREFIX = "bubbleId:";
const COMPOSER_HEADERS_KEY = "composer.composerHeaders";

/** One chat in the composer index, with its newest-activity timestamp. */
interface CursorComposerHeader {
  readonly composerId: string;
  readonly modifiedMs: number;
}

/** Read-only accessor over the Cursor composer database. */
interface CursorDbHandle {
  composerHeaders(): CursorComposerHeader[];
  composerValue(composerId: string): string | null;
  bubbleValues(composerId: string): string[];
  contentValue(contentId: string): string | null;
}

export type { CursorComposerHeader, CursorDbHandle };

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

// Cursor ships a stable build and a "Nightly" build; each keeps its own
// application-support tree, so both are scanned.
const CURSOR_APP_DIR_NAMES = ["Cursor", "Cursor Nightly"];

const cursorAppDirs = (): string[] => {
  if (process.platform === "darwin") {
    const base = path.join(os.homedir(), "Library", "Application Support");
    return CURSOR_APP_DIR_NAMES.map((name) => path.join(base, name));
  }
  if (process.platform === "win32") {
    const appData = process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming");
    return CURSOR_APP_DIR_NAMES.map((name) => path.join(appData, name));
  }
  const configHome = process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), ".config");
  return CURSOR_APP_DIR_NAMES.map((name) => path.join(configHome, name));
};

/**
 * Absolute paths to every readable Cursor composer database — the stable and
 * Nightly builds each keep their own. A `REACT_DOCTOR_CURSOR_DB` override pins
 * a single database (used by tests). Returns `[]` when none exist.
 */
export const resolveCursorDbPaths = (): string[] => {
  const override = process.env.REACT_DOCTOR_CURSOR_DB;
  const candidates = override
    ? [override]
    : cursorAppDirs().map((directory) => path.join(directory, CURSOR_DB_RELATIVE_PATH));
  return candidates.filter((candidate) => fs.existsSync(candidate));
};

const modifiedMsFromHeader = (head: Record<string, unknown>): number => {
  const lastUpdatedAt = head.lastUpdatedAt;
  if (typeof lastUpdatedAt === "number") return lastUpdatedAt;
  const createdAt = head.createdAt;
  if (typeof createdAt === "number") return createdAt;
  return 0;
};

const parseComposerHeaders = (raw: string): CursorComposerHeader[] => {
  let decoded: unknown;
  try {
    decoded = JSON.parse(raw);
  } catch {
    return [];
  }
  const record = asRecord(decoded);
  let list: unknown[] = [];
  if (Array.isArray(decoded)) {
    list = decoded;
  } else if (record && Array.isArray(record.allComposers)) {
    list = record.allComposers;
  }
  const headers: CursorComposerHeader[] = [];
  for (const entry of list) {
    const head = asRecord(entry);
    const composerId = head && asNullableString(head.composerId);
    if (head && composerId) {
      headers.push({ composerId, modifiedMs: modifiedMsFromHeader(head) });
    }
  }
  return headers;
};

// node:sqlite returns each row as an object keyed by column name.
const rowValueString = (row: unknown): string | null => {
  const record = asRecord(row);
  return record ? asNullableString(record.value) : null;
};

// The exclusive upper bound for a key prefix: the prefix with its last byte
// incremented. A `key >= prefix AND key < upper` range always uses the primary
// key index, unlike `LIKE 'prefix%'`, which a BINARY-collated index can't serve
// (and so falls back to a full scan of the multi-GB database).
const prefixUpperBound = (prefix: string): string =>
  prefix.slice(0, -1) + String.fromCharCode(prefix.charCodeAt(prefix.length - 1) + 1);

interface OpenDb {
  readonly handle: CursorDbHandle;
  readonly close: () => void;
}

const makeHandle = (dbPath: string): OpenDb | null => {
  // `node:sqlite` is built in on Node 22.13+/24+; absent on older Node, where
  // opening returns null and Cursor stats degrade to "no sessions found".
  const database = openReadOnlySqlite(dbPath);
  if (!database) return null;
  const close = (): void => {
    try {
      database.close();
    } catch {
      // Already closed or never fully opened — nothing to release.
    }
  };

  try {
    const headersStatement = database.prepare(`SELECT value FROM ItemTable WHERE key = ?`);
    const composerStatement = database.prepare(`SELECT value FROM cursorDiskKV WHERE key = ?`);
    const bubbleStatement = database.prepare(
      `SELECT value FROM cursorDiskKV WHERE key >= ? AND key < ?`,
    );

    const handle: CursorDbHandle = {
      composerHeaders(): CursorComposerHeader[] {
        try {
          const raw = rowValueString(headersStatement.get(COMPOSER_HEADERS_KEY));
          return raw ? parseComposerHeaders(raw) : [];
        } catch {
          return [];
        }
      },
      composerValue(composerId: string): string | null {
        try {
          return rowValueString(composerStatement.get(`${COMPOSER_DATA_PREFIX}${composerId}`));
        } catch {
          return null;
        }
      },
      bubbleValues(composerId: string): string[] {
        try {
          const prefix = `${BUBBLE_PREFIX}${composerId}:`;
          const rows = bubbleStatement.all(prefix, prefixUpperBound(prefix));
          const values: string[] = [];
          for (const row of rows) {
            const value = rowValueString(row);
            if (value) values.push(value);
          }
          return values;
        } catch {
          return [];
        }
      },
      contentValue(contentId: string): string | null {
        try {
          return rowValueString(composerStatement.get(contentId));
        } catch {
          return null;
        }
      },
    };

    return { handle, close };
  } catch {
    // A locked or unreadable database can throw when statements are prepared;
    // skip it rather than sinking the whole stats run.
    close();
    return null;
  }
};

// One open handle per database path — opening is cheap (SQLite memory-maps
// lazily), but reopening per composer during a scan would thrash. The stable
// and Nightly databases can both be open at once, so they're memoized by path.
// `closeCursorDb` closes them for tests (so Windows can unlink the fixture
// file); the CLI relies on process exit.
const openDatabases = new Map<string, { handle: CursorDbHandle | null; close: () => void }>();

/** Open (and memoize) a composer database by path, or `null` when unavailable. */
export const openCursorDb = (dbPath: string | null): CursorDbHandle | null => {
  if (!dbPath) return null;
  const cached = openDatabases.get(dbPath);
  if (cached) return cached.handle;
  const opened = makeHandle(dbPath);
  const entry = { handle: opened?.handle ?? null, close: opened?.close ?? (() => {}) };
  openDatabases.set(dbPath, entry);
  return entry.handle;
};

/** Close and drop every memoized database (tests open fresh fixture databases). */
export const closeCursorDb = (): void => {
  for (const database of openDatabases.values()) database.close();
  openDatabases.clear();
};
