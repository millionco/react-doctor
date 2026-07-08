import crypto from "node:crypto";
import path from "node:path";
import { CONFIG_FINGERPRINT_FILENAMES } from "../constants.js";
import { hashFileContents } from "./hash-file-contents.js";

// Content-hashed (not stat-fingerprinted) so the fingerprint survives a fresh
// CI checkout, where every file's mtime is checkout time: identical config
// content keys identically across re-clones. The files are configs and
// manifests — small enough that hashing the chain costs single-digit
// milliseconds per scan (lockfiles are the largest, and hashing is far
// cheaper than the scan they key).
export const computeConfigFingerprint = (projectDirectory: string, version: string): string => {
  const parts: string[] = [`v=${version}`];
  let directory = projectDirectory;
  for (;;) {
    for (const filename of CONFIG_FINGERPRINT_FILENAMES) {
      const contentHash = hashFileContents(path.join(directory, filename));
      if (contentHash !== null) parts.push(`${directory}/${filename}=${contentHash}`);
    }
    const parent = path.dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  return crypto.createHash("sha1").update(parts.join("|")).digest("hex");
};
