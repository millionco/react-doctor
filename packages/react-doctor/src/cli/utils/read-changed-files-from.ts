import * as fs from "node:fs";
import * as path from "node:path";
import { CliInputError } from "./cli-input-error.js";
import { toForwardSlashes } from "./path-format.js";

const isSafeRelativePath = (filePath: string): boolean => {
  if (filePath.length === 0) return false;
  if (filePath.includes("\0")) return false;
  if (path.isAbsolute(filePath)) return false;
  const normalized = path.posix.normalize(filePath);
  if (normalized === "." || normalized.startsWith("../") || normalized === "..") return false;
  return normalized === filePath;
};

export const readChangedFilesFrom = (filePath: string): string[] => {
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, "utf8");
  } catch (error) {
    // The path comes from the user's `--changed-files-from <file>`, so an
    // unreadable file (missing, a directory, permission-denied, or a stale
    // pipe/process-substitution fd — EBADF, REACT-DOCTOR-V) is an invocation
    // mistake, not a bug. Surface it as a clean CLI error instead of crashing
    // and reporting the read failure to Sentry.
    const errorCode = (error as NodeJS.ErrnoException)?.code;
    throw new CliInputError(
      `Could not read the --changed-files-from file "${filePath}"${errorCode ? ` (${errorCode})` : ""}. ` +
        "Pass a path to a readable text file that lists changed files, one per line.",
    );
  }
  const uniqueFiles = new Set<string>();
  for (const line of raw.split(/\r?\n/)) {
    const candidate = toForwardSlashes(line.trim());
    if (!isSafeRelativePath(candidate)) continue;
    uniqueFiles.add(candidate);
  }
  return [...uniqueFiles];
};
