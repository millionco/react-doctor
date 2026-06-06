import { spawnSync } from "node:child_process";

// Returns the subset of `relativePaths` that `git check-ignore` considers
// ignored. When git is unavailable or the directory is not a checkout,
// returns an empty set so callers degrade gracefully (no false filtering).
// Paths are checked in a single `git check-ignore` invocation via --stdin
// for efficiency.
export const collectGitIgnoredPaths = (
  rootDirectory: string,
  relativePaths: ReadonlyArray<string>,
): Set<string> => {
  if (relativePaths.length === 0) return new Set();

  const result = spawnSync("git", ["check-ignore", "--stdin", "-z"], {
    cwd: rootDirectory,
    input: relativePaths.join("\0"),
    encoding: "utf-8",
    maxBuffer: 10 * 1024 * 1024,
  });

  if (result.error || result.status === null || result.status > 1) {
    return new Set();
  }

  const ignoredPaths = result.stdout
    .split("\0")
    .filter((entry) => entry.length > 0);

  return new Set(ignoredPaths);
};
