import crypto from "node:crypto";
import * as fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import { CACHE_FILENAME_HASH_LENGTH_CHARS } from "../constants.js";

// SHA-256 (not SHA-1) purely to name a per-project cache subdirectory — it's a
// filesystem-safe digest of the path, never a security/identity hash.
const projectCacheSubdir = (projectDirectory: string): string =>
  crypto
    .createHash("sha256")
    .update(projectDirectory)
    .digest("hex")
    .slice(0, CACHE_FILENAME_HASH_LENGTH_CHARS);

// Resolves the directory react-doctor's on-disk caches live in. Order:
//   1. `REACT_DOCTOR_CACHE_DIR` — an operator/CI-pinned cache root. The GitHub
//      Action points this at a single `${runner.temp}` path it can persist with
//      `actions/cache` across runs (the project-local `node_modules/.cache` is
//      a fresh, SHA-scoped checkout in CI, so it never survives between commits).
//      A per-project subdirectory keeps a batch scan's projects from colliding.
//   2. the project's `node_modules/.cache/react-doctor` (npm convention,
//      project-local, cleaned by `node_modules` removal).
//   3. a per-project subdirectory of the OS temp dir, when the project has no
//      `node_modules` (e.g. a not-yet-installed checkout).
// The whole-repo scan cache, the per-file lint cache, and the supply-chain cache
// sit side by side here under distinct filenames.
export const resolveReactDoctorCacheDir = (projectDirectory: string): string => {
  const cacheDirOverride = process.env["REACT_DOCTOR_CACHE_DIR"]?.trim();
  if (cacheDirOverride) {
    return path.join(cacheDirOverride, projectCacheSubdir(projectDirectory));
  }
  const nodeModulesDirectory = path.join(projectDirectory, "node_modules");
  if (fs.existsSync(nodeModulesDirectory)) {
    return path.join(nodeModulesDirectory, ".cache", "react-doctor");
  }
  return path.join(os.tmpdir(), "react-doctor-cache", projectCacheSubdir(projectDirectory));
};
