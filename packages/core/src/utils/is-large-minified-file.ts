import * as fs from "node:fs";
import { MINIFIED_MIN_SIZE_BYTES } from "../project-info/constants.js";
import { isMinifiedSource } from "./is-minified-source.js";

const cachedIsLargeMinifiedByPath = new Map<string, boolean>();

// Clears the memoized classifications so a long-running consumer (watch mode,
// agentic CLI, repeated `diagnose()`) re-sniffs files that changed between
// calls. Wired into `clearCaches()` alongside the other module-scope caches.
export const clearMinifiedFileCache = (): void => {
  cachedIsLargeMinifiedByPath.clear();
};

// File size in bytes, or `null` on any stat error (matches the keep-on-error
// contract of `isLargeMinifiedFile` below). Exposed so the whole-tree
// discovery walk can reuse the single stat it already pays instead of
// re-stat'ing every file for the lint-batch cost proxy.
export const statSourceFileSize = (absolutePath: string): number | null => {
  try {
    return fs.statSync(absolutePath).size;
  } catch {
    return null;
  }
};

// Whether a file is large enough to plausibly be a bundle AND sniffs as
// minified. The size gate keeps whole-tree discovery from reading every
// small source file just to check. Both `listSourceFiles` (the scanned set)
// and `countSourceFiles` (the reported `sourceFileCount`) route through here
// so the two can never diverge. Memoized by absolute path because a full scan
// walks the tree more than once; returns (and caches) false on any stat error
// so an unreadable file is kept / counted as usual. A caller that already
// stat'd the file (the sized-discovery walk) passes `knownSizeBytes` to skip
// the second stat; bare callers (`countSourceFiles`) stat here.
export const isLargeMinifiedFile = (
  absolutePath: string,
  knownSizeBytes?: number | null,
): boolean => {
  const cached = cachedIsLargeMinifiedByPath.get(absolutePath);
  if (cached !== undefined) return cached;

  const sizeBytes =
    knownSizeBytes === undefined ? statSourceFileSize(absolutePath) : knownSizeBytes;
  const result =
    sizeBytes !== null && sizeBytes >= MINIFIED_MIN_SIZE_BYTES && isMinifiedSource(absolutePath);
  cachedIsLargeMinifiedByPath.set(absolutePath, result);
  return result;
};
