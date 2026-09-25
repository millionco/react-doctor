import crypto from "node:crypto";
import * as fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import { CACHE_FILENAME_HASH_LENGTH_CHARS } from "../constants.js";
import { findGitRepositoryRoot } from "./find-git-repository-root.js";

const resolveRelativeProjectPath = (projectDirectory: string): string | null => {
  const explicitPartition = process.env["REACT_DOCTOR_CACHE_PARTITION"]?.trim();
  if (explicitPartition) return explicitPartition;

  const gitRoot = findGitRepositoryRoot(projectDirectory);
  if (!gitRoot) return null;

  const relativePath = path.relative(gitRoot, projectDirectory);
  return relativePath || ".";
};

const projectCacheSubdir = (projectDirectory: string): string => {
  const relativePath = resolveRelativeProjectPath(projectDirectory);
  const pathToHash = relativePath ?? projectDirectory;

  return crypto
    .createHash("sha256")
    .update(pathToHash)
    .digest("hex")
    .slice(0, CACHE_FILENAME_HASH_LENGTH_CHARS);
};

// Resolves the directory react-doctor's on-disk caches live in. Order:
//   1. `REACT_DOCTOR_CACHE_DIR` — an operator/CI-pinned cache root. The GitHub
//      Action points this at a single `${runner.temp}` path it can persist with
//      `actions/cache` across runs (the project-local `node_modules/.cache` is
//      a fresh, SHA-scoped checkout in CI, so it never survives between commits).
//      A per-project subdirectory keeps a batch scan's projects from colliding.
//      The subdirectory name is a hash of the git-relative project path (when in
//      a git repo) or `REACT_DOCTOR_CACHE_PARTITION` (when set), making the cache
//      portable between CI and local checkouts of the same repository. Falls back
//      to hashing the absolute path when neither is available.
//   2. the project's `node_modules/.cache/react-doctor` (npm convention,
//      project-local, cleaned by `node_modules` removal).
//   3. a per-user, per-project subdirectory of the OS temp dir, when the
//      project has no `node_modules` (e.g. a not-yet-installed checkout). The
//      uid is folded into the directory name because the OS temp dir is
//      world-writable and the path is otherwise predictable — without it,
//      another local user could pre-create the directory and plant cache
//      contents (suppressed or fabricated cached diagnostics).
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
  return path.join(
    os.tmpdir(),
    `react-doctor-cache-${resolveUserCacheScope()}`,
    projectCacheSubdir(projectDirectory),
  );
};

// `os.userInfo()` can throw on systems with no passwd entry for the uid;
// fall back to the raw uid (POSIX) or username (Windows has no getuid).
const resolveUserCacheScope = (): string => {
  try {
    return String(process.getuid?.() ?? os.userInfo().username);
  } catch {
    return "shared";
  }
};
