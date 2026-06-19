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

// Whether a file is large enough to plausibly be a bundle AND sniffs as
// minified. The size gate keeps whole-tree discovery from reading every
// small source file just to check. Both `listSourceFiles` (the scanned set)
// and `countSourceFiles` (the reported `sourceFileCount`) route through here
// so the two can never diverge. Memoized by absolute path because a full scan
// walks the tree more than once; returns (and caches) false on any stat error
// so an unreadable file is kept / counted as usual.
export const isLargeMinifiedFile = (absolutePath: string): boolean => {
  const cached = cachedIsLargeMinifiedByPath.get(absolutePath);
  if (cached !== undefined) return cached;

  let result: boolean;
  try {
    const sizeBytes = fs.statSync(absolutePath).size;
    result = sizeBytes >= MINIFIED_MIN_SIZE_BYTES && isMinifiedSource(absolutePath);
  } catch {
    result = false;
  }
  cachedIsLargeMinifiedByPath.set(absolutePath, result);
  return result;
};
