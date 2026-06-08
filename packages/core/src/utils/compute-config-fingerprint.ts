import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { CONFIG_FINGERPRINT_FILENAMES } from "../constants.js";

export const computeConfigFingerprint = (projectDirectory: string, version: string): string => {
  const parts: string[] = [`v=${version}`];
  let directory = projectDirectory;
  for (;;) {
    for (const filename of CONFIG_FINGERPRINT_FILENAMES) {
      try {
        const stat = fs.statSync(path.join(directory, filename));
        parts.push(`${directory}/${filename}=${stat.mtimeMs}:${stat.size}`);
      } catch {
        continue;
      }
    }
    const parent = path.dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  return crypto.createHash("sha1").update(parts.join("|")).digest("hex");
};
