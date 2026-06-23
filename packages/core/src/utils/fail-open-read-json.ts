import * as fs from "node:fs";

// Reads + parses a JSON file, returning `fallback` on ANY failure (missing
// file, permission error, malformed JSON). Caches that fail open never throw
// and never serve a partial read — a corrupt cache degrades to a full re-scan,
// never to a wrong result.
export const failOpenReadJson = <T>(filePath: string, fallback: T): T => {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
  } catch {
    return fallback;
  }
};
