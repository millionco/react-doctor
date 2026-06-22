import * as fs from "node:fs";
import * as path from "node:path";
import type { AgentSession, SessionCandidate, StatsProvider } from "./types.js";

/** File modification time in ms, or 0 when the file is missing/unreadable. */
export const statMtimeMs = (filePath: string): number => {
  try {
    return fs.statSync(filePath).mtimeMs;
  } catch {
    return 0;
  }
};

/**
 * Turn a transcript-file-based provider into lazy `SessionCandidate`s: one per
 * `.jsonl` file under its roots, each parsed only when `load()` is called. The
 * file's mtime is the sort + `--since` key.
 */
export const fileSessionCandidates = (
  provider: StatsProvider,
  roots: ReadonlyArray<string>,
  discover: (root: string) => string[],
  parse: (transcriptPath: string) => AgentSession | null,
): SessionCandidate[] => {
  const candidates: SessionCandidate[] = [];
  for (const root of roots) {
    for (const transcriptPath of discover(root)) {
      candidates.push({
        provider,
        modifiedMs: statMtimeMs(transcriptPath),
        load: () => parse(transcriptPath),
      });
    }
  }
  return candidates;
};

/**
 * Recursively collect `.jsonl` transcript files under `root` up to `maxDepth`
 * directory levels deep. Returns absolute paths sorted newest-first by mtime so
 * a `--limit` keeps the most recent sessions. Missing roots yield `[]`.
 */
export const findJsonlFiles = (root: string, maxDepth: number): string[] => {
  const found: Array<{ filePath: string; modifiedMs: number }> = [];

  const walk = (directory: string, depth: number): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (depth < maxDepth) walk(entryPath, depth + 1);
      } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
        let modifiedMs = 0;
        try {
          modifiedMs = fs.statSync(entryPath).mtimeMs;
        } catch {
          modifiedMs = 0;
        }
        found.push({ filePath: entryPath, modifiedMs });
      }
    }
  };

  walk(root, 0);
  found.sort((left, right) => right.modifiedMs - left.modifiedMs);
  return found.map((entry) => entry.filePath);
};

/**
 * Parse each non-empty line of a JSONL file, invoking `onEntry` with the decoded
 * object. Unparseable lines and unreadable files are skipped silently so one
 * corrupt transcript never sinks a whole run.
 */
export const readJsonlEntries = (
  filePath: string,
  onEntry: (entry: Record<string, unknown>) => void,
): void => {
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, "utf8");
  } catch {
    return;
  }
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    let entry: unknown;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (entry && typeof entry === "object") onEntry(entry as Record<string, unknown>);
  }
};
