import { spawnSync } from "node:child_process";

// Whether `git` considers `absolutePath` ignored, relative to
// `rootDirectory`. Returns `null` when the ignore status can't be
// determined — `git` is missing, the directory isn't a checkout, or the
// command errors — so callers can decide how to handle the unknown case.
//
// `git check-ignore -q <path>` exits 0 when the path is ignored, 1 when
// it is not, and 128 on any other error (no repo, bad cwd, …). The index
// is intentionally consulted (no `--no-index`): a `.env*.local` already
// committed to the repo reports as *not* ignored, which is exactly the
// state we want to flag.
export const isPathGitIgnored = (rootDirectory: string, absolutePath: string): boolean | null => {
  const result = spawnSync("git", ["check-ignore", "-q", absolutePath], {
    cwd: rootDirectory,
    stdio: ["ignore", "ignore", "ignore"],
  });
  if (result.error) return null;
  if (result.status === 0) return true;
  if (result.status === 1) return false;
  return null;
};
