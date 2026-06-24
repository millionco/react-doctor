import crypto from "node:crypto";
import * as fs from "node:fs";

// Content hash of a file's bytes (SHA-1, hex). Used as the per-file lint cache
// key so a cache hit depends on the file's actual content — surviving CI
// re-clones (where mtimes reset but content is identical) and matching across
// reverts to a previously-seen content. Returns `null` on any read failure so
// an unreadable file is treated as a cache miss and simply re-linted.
export const hashFileContents = (filePath: string): string | null => {
  try {
    return crypto.createHash("sha1").update(fs.readFileSync(filePath)).digest("hex");
  } catch {
    return null;
  }
};
