import * as fs from "node:fs";
import * as path from "node:path";
import type { DependencyManifest } from "../types.js";

// Reads and parses a `package.json` from a directory. Returns `null` when the
// file is absent or unparseable rather than throwing — discovery walks treat
// a missing/broken manifest as "no dependencies declared here".
export const readPackageJson = (directory: string): DependencyManifest | null => {
  const manifestPath = path.join(directory, "package.json");
  let raw: string;
  try {
    raw = fs.readFileSync(manifestPath, "utf8");
  } catch {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    return parsed;
  } catch {
    return null;
  }
};
