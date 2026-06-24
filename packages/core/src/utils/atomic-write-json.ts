import * as fs from "node:fs";
import * as path from "node:path";

// Writes `value` as JSON to `filePath` atomically: serialize to a
// pid-suffixed temp file in the same directory, then rename over the target so
// a concurrent reader sees either the old or the new file, never a half-written
// one. Swallows every error — a cache that can't persist must not break a scan.
export const atomicWriteJson = (filePath: string, value: unknown): void => {
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const temporaryPath = `${filePath}.${process.pid}.tmp`;
    fs.writeFileSync(temporaryPath, JSON.stringify(value));
    fs.renameSync(temporaryPath, filePath);
  } catch {
    return;
  }
};
