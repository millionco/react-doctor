import path from "node:path";
import { DEBUG_MAX_DEDUP_ENTRIES } from "../utils/constants.js";

export interface DebugSessionState {
  logPath: string;
  processedEntryIds: Set<string>;
}

export interface DebugSessionStore {
  get(requestSessionId: string): DebugSessionState;
}

interface DebugSessionStoreOptions {
  primarySessionId: string;
  primaryLogPath: string;
  logDirectory: string;
}

// Session ids index a per-session log filename (`debug-<id>.log`), so they
// must stay within the log directory: only word chars, dash, underscore —
// no path separators or `..`.
export const SESSION_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;

export const parseIngestSessionId = (url: string): string | null => {
  try {
    const { pathname } = new URL(url, "http://localhost");
    const match = pathname.match(/^\/ingest\/([a-zA-Z0-9_-]+)\/?$/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
};

// Remember an entry id for de-duplication, bounding memory by dropping the
// whole set once it grows past the cap (best-effort: a repeat after a reset
// can slip through, which is acceptable for a debug session).
export const rememberProcessedEntryId = (state: DebugSessionState, entryId: string): void => {
  if (state.processedEntryIds.size >= DEBUG_MAX_DEDUP_ENTRIES) {
    state.processedEntryIds.clear();
  }
  state.processedEntryIds.add(entryId);
};

export const createDebugSessionStore = (options: DebugSessionStoreOptions): DebugSessionStore => {
  const sessions = new Map<string, DebugSessionState>();

  const get = (requestSessionId: string): DebugSessionState => {
    const existing = sessions.get(requestSessionId);
    if (existing) return existing;

    const logPath =
      requestSessionId === options.primarySessionId
        ? options.primaryLogPath
        : path.join(options.logDirectory, `debug-${requestSessionId}.log`);
    const state: DebugSessionState = { logPath, processedEntryIds: new Set() };
    sessions.set(requestSessionId, state);
    return state;
  };

  return { get };
};
