import * as fs from "node:fs";
import { MINIFIED_MIN_SIZE_BYTES } from "../project-info/constants.js";
import { isMinifiedSource } from "./is-minified-source.js";

// Whether a file is large enough to plausibly be a bundle AND sniffs as
// minified. The size gate keeps whole-tree discovery from reading every
// small source file just to check. Both `listSourceFiles` (the scanned set)
// and `countSourceFiles` (the reported `sourceFileCount`) route through here
// so the two can never diverge. Returns false on any stat error so an
// unreadable file is kept / counted as usual.
export const isLargeMinifiedFile = (absolutePath: string): boolean => {
  let sizeBytes: number;
  try {
    sizeBytes = fs.statSync(absolutePath).size;
  } catch {
    return false;
  }
  if (sizeBytes < MINIFIED_MIN_SIZE_BYTES) return false;
  return isMinifiedSource(absolutePath);
};
