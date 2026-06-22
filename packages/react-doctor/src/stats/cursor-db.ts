import * as fs from "node:fs";
import { createRequire } from "node:module";
import * as os from "node:os";
import * as path from "node:path";

const nodeRequire = createRequire(import.meta.url);

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

const asString = (value: unknown): string | null => (typeof value === "string" ? value : null);

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const cursorAppDir = (): string => {
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", "Cursor");
  }
  if (process.platform === "win32") {
    const appData = process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming");
    return path.join(appData, "Cursor");
  }
  const configHome = process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), ".config");
  return path.join(configHome, "Cursor");
};

/**
 * Absolute path to the Cursor composer database, honoring a
 * `REACT_DOCTOR_CURSOR_DB` override (used by tests). Returns `null` when no
 * readable database exists.
 */
export const resolveCursorDbPath = (): string | null => {
  const candidate =
    process.env.REACT_DOCTOR_CURSOR_DB ?? path.join(cursorAppDir(), CURSOR_DB_RELATIVE_PATH);
  return fs.existsSync(candidate) ? candidate : null;
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
  const list = Array.isArray(decoded)
    ? decoded
    : record && Array.isArray(record.allComposers)
      ? record.allComposers
      : [];
  const headers: CursorComposerHeader[] = [];
  for (const entry of list) {
    const head = asRecord(entry);
    const composerId = head && asString(head.composerId);
    if (head && composerId) {
      headers.push({ composerId, modifiedMs: modifiedMsFromHeader(head) });
    }
  }
  return headers;
};

// node:sqlite returns each row as an object keyed by column name.
const rowValueString = (row: unknown): string | null => {
  const record = asRecord(row);
  return record ? asString(record.value) : null;
};

// The exclusive upper bound for a key prefix: the prefix with its last byte
// incremented. A `key >= prefix AND key < upper` range always uses the primary
// key index, unlike `LIKE 'prefix%'`, which a BINARY-collated index can't serve
// (and so falls back to a full scan of the multi-GB database).
const prefixUpperBound = (prefix: string): string =>
  prefix.slice(0, -1) + String.fromCharCode(prefix.charCodeAt(prefix.length - 1) + 1);

const makeHandle = (dbPath: string): CursorDbHandle | null => {
  let database: {
    prepare(sql: string): {
      get(...params: unknown[]): unknown;
      all(...params: unknown[]): unknown[];
    };
  };
  try {
    // `node:sqlite` is built in on Node 22.13+/24+; absent on older Node, where
    // the require throws and Cursor stats degrade to "no sessions found".
    const { DatabaseSync } = nodeRequire("node:sqlite");
    database = new DatabaseSync(dbPath, { readOnly: true });
  } catch {
    return null;
  }

  const headersStatement = database.prepare(`SELECT value FROM ItemTable WHERE key = ?`);
  const composerStatement = database.prepare(`SELECT value FROM cursorDiskKV WHERE key = ?`);
  const bubbleStatement = database.prepare(
    `SELECT value FROM cursorDiskKV WHERE key >= ? AND key < ?`,
  );

  return {
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
};

// One open handle per process — opening is cheap (SQLite memory-maps lazily),
// but reopening per composer during a scan would thrash. `closeCursorDb` resets
// it for tests; the CLI relies on process exit.
let cachedHandle: { dbPath: string; handle: CursorDbHandle | null } | null = null;

/** Open (and memoize) the composer database, or `null` when unavailable. */
export const openCursorDb = (dbPath: string | null): CursorDbHandle | null => {
  if (!dbPath) return null;
  if (cachedHandle && cachedHandle.dbPath === dbPath) return cachedHandle.handle;
  cachedHandle = { dbPath, handle: makeHandle(dbPath) };
  return cachedHandle.handle;
};

/** Drop the memoized handle (tests open fresh fixture databases). */
export const closeCursorDb = (): void => {
  cachedHandle = null;
};
