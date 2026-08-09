import { atomicWriteFile } from "./atomic-write-file.js";

// Writes `value` as JSON to `filePath` atomically: serialize to a unique temp
// file in the same directory, then rename over the target so
// a concurrent reader sees either the old or the new file, never a half-written
// one. Swallows every error — a cache that can't persist must not break a scan.
export const atomicWriteJson = (filePath: string, value: unknown): void => {
  try {
    atomicWriteFile(filePath, JSON.stringify(value));
  } catch {
    return;
  }
};
