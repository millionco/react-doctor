import crypto from "node:crypto";
import * as fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import { CACHE_FILENAME_HASH_LENGTH_CHARS } from "../constants.js";

// Resolves the directory react-doctor's on-disk caches live in. Prefers the
// project's `node_modules/.cache/react-doctor` (npm convention, project-local,
// cleaned by `node_modules` removal) and falls back to a per-project
// subdirectory of the OS temp dir when the project has no `node_modules` (e.g.
// a not-yet-installed checkout). Both the whole-repo scan cache and the
// per-file lint cache sit side by side here under distinct filenames.
export const resolveReactDoctorCacheDir = (projectDirectory: string): string => {
  const nodeModulesDirectory = path.join(projectDirectory, "node_modules");
  if (fs.existsSync(nodeModulesDirectory)) {
    return path.join(nodeModulesDirectory, ".cache", "react-doctor");
  }
  // SHA-256 (not SHA-1) purely to name a per-project cache subdirectory — it's
  // a filesystem-safe digest of the path, never a security/identity hash.
  const projectHash = crypto
    .createHash("sha256")
    .update(projectDirectory)
    .digest("hex")
    .slice(0, CACHE_FILENAME_HASH_LENGTH_CHARS);
  return path.join(os.tmpdir(), "react-doctor-cache", projectHash);
};
