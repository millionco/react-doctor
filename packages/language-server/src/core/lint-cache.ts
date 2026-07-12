import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { messageFromUnknown, type Diagnostic as CoreDiagnostic } from "@react-doctor/core";
import {
  CACHE_FILENAME_HASH_LENGTH_CHARS,
  LINT_CACHE_PERSIST_DEBOUNCE_MS,
  LINT_CACHE_VERSION,
} from "../constants.js";
import { SILENT_LOGGER, type Logger } from "../types.js";

export interface FileIdentity {
  readonly contentHash: string;
}

interface LintCacheEntry extends FileIdentity {
  readonly diagnostics: CoreDiagnostic[];
}

interface PersistedCache {
  readonly version: number;
  readonly fingerprint: string;
  readonly entries: Record<string, LintCacheEntry>;
}

/**
 * Per-project, content-aware lint result cache. Keyed by absolute file
 * path + content hash so an unchanged file skips the oxlint subprocess
 * entirely on re-scan. Namespaced by a config fingerprint so a config /
 * dependency change starts fresh. Persisted to disk so a re-opened editor
 * gets near-instant diagnostics for everything it hasn't edited.
 */
export interface LintCache {
  /** Cached diagnostics for `fsPath` if its identity matches, else `null`. */
  readonly lookup: (fsPath: string, identity: FileIdentity) => CoreDiagnostic[] | null;
  /** Record the diagnostics for a freshly-scanned file (empty = clean). */
  readonly store: (fsPath: string, identity: FileIdentity, diagnostics: CoreDiagnostic[]) => void;
  /** Debounced write-back to disk. */
  readonly schedulePersist: () => void;
  /** Write to disk now (cancels any pending debounce). */
  readonly flush: () => void;
}

const resolveCacheFilePath = (projectDirectory: string): string => {
  const nodeModules = path.join(projectDirectory, "node_modules");
  if (fs.existsSync(nodeModules)) {
    return path.join(nodeModules, ".cache", "react-doctor", "lint-cache.json");
  }
  // No node_modules (rare for a React project) → fall back to a temp dir
  // keyed by a hash of the project path so projects don't collide.
  const key = crypto
    .createHash("sha1")
    .update(projectDirectory)
    .digest("hex")
    .slice(0, CACHE_FILENAME_HASH_LENGTH_CHARS);
  return path.join(os.tmpdir(), "react-doctor-cache", `${key}.json`);
};

export const createLintCache = (input: {
  readonly projectDirectory: string;
  readonly fingerprint: string;
  readonly logger?: Logger;
}): LintCache => {
  const logger = input.logger ?? SILENT_LOGGER;
  const cacheFilePath = resolveCacheFilePath(input.projectDirectory);
  const entries = new Map<string, LintCacheEntry>();
  let dirty = false;
  let persistTimer: ReturnType<typeof setTimeout> | null = null;

  // Load a previous session's cache when the config fingerprint matches.
  try {
    const parsed: PersistedCache = JSON.parse(fs.readFileSync(cacheFilePath, "utf8"));
    if (parsed.version === LINT_CACHE_VERSION && parsed.fingerprint === input.fingerprint) {
      for (const [fsPath, entry] of Object.entries(parsed.entries)) {
        entries.set(fsPath, entry);
      }
    }
  } catch {
    // Missing / unreadable / stale-fingerprint cache → start empty.
  }

  const persist = (): void => {
    if (persistTimer) {
      clearTimeout(persistTimer);
      persistTimer = null;
    }
    if (!dirty) return;
    dirty = false;
    try {
      const payload: PersistedCache = {
        version: LINT_CACHE_VERSION,
        fingerprint: input.fingerprint,
        entries: Object.fromEntries(entries),
      };
      fs.mkdirSync(path.dirname(cacheFilePath), { recursive: true });
      // Atomic write: a crash mid-write can't corrupt the cache.
      const tempPath = `${cacheFilePath}.${process.pid}.tmp`;
      fs.writeFileSync(tempPath, JSON.stringify(payload));
      fs.renameSync(tempPath, cacheFilePath);
    } catch (error) {
      logger.warn(`Failed to persist lint cache: ${messageFromUnknown(error)}`);
    }
  };

  return {
    lookup: (fsPath, identity) => {
      const entry = entries.get(fsPath);
      if (entry !== undefined && entry.contentHash === identity.contentHash) {
        return entry.diagnostics;
      }
      return null;
    },
    store: (fsPath, identity, diagnostics) => {
      entries.set(fsPath, { ...identity, diagnostics });
      dirty = true;
    },
    schedulePersist: () => {
      if (!dirty || persistTimer) return;
      persistTimer = setTimeout(persist, LINT_CACHE_PERSIST_DEBOUNCE_MS);
      if (typeof persistTimer.unref === "function") persistTimer.unref();
    },
    flush: persist,
  };
};
