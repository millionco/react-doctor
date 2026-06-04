import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { CONFIG_WATCH_FILENAMES } from "../constants.js";

/**
 * Fingerprint of everything (outside file content) that affects lint
 * output for a project: the React Doctor version plus the size + mtime of
 * each config / manifest / lockfile. A change to any of them invalidates
 * the persisted per-file lint cache, since rules, capabilities, adopted
 * configs, and dependency-derived settings all flow from these files.
 */
export const computeConfigFingerprint = (projectDirectory: string, version: string): string => {
  const parts: string[] = [`v=${version}`];
  // Walk from the project up to the filesystem root so a monorepo
  // sub-package's fingerprint also reflects ancestor config / lockfiles
  // (e.g. a root `pnpm-lock.yaml`) — the same files the watcher invalidates
  // caches on. Each level is keyed by its absolute path so they stay
  // distinct, and only files that exist contribute (add / remove / edit all
  // change the hash).
  let directory = projectDirectory;
  for (;;) {
    for (const filename of CONFIG_WATCH_FILENAMES) {
      try {
        const stat = fs.statSync(path.join(directory, filename));
        parts.push(`${directory}/${filename}=${stat.mtimeMs}:${stat.size}`);
      } catch {
        // Absent at this level — contributes nothing.
      }
    }
    const parent = path.dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  return crypto.createHash("sha1").update(parts.join("|")).digest("hex");
};
