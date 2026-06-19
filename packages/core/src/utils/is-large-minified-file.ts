import * as fs from "node:fs";
import { MINIFIED_MIN_SIZE_BYTES } from "../project-info/constants.js";
import { isMinifiedSource } from "./is-minified-source.js";

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
// so the two can never diverge. Returns false on any stat error so an
// unreadable file is kept / counted as usual.
export const isLargeMinifiedFile = (
  absolutePath: string,
  knownSizeBytes?: number | null,
): boolean => {
  // Reuse a size the caller already stat'd (the sized-discovery walk) instead
  // of paying a second stat; bare callers (`countSourceFiles`) stat here.
  const sizeBytes =
    knownSizeBytes === undefined ? statSourceFileSize(absolutePath) : knownSizeBytes;
  if (sizeBytes === null || sizeBytes < MINIFIED_MIN_SIZE_BYTES) return false;
  return isMinifiedSource(absolutePath);
};
