import { spawnSync } from "node:child_process";
import { devNull } from "node:os";
import { GIT_CHECK_IGNORE_MAX_BUFFER_BYTES } from "../constants.js";

export interface GitIgnoredPathsResult {
  ignoredPaths: Set<string>;
  gitUnavailable: boolean;
}

/**
 * Returns the subset of `candidatePaths` that git considers ignored.
 *
 * `--no-index` is load-bearing: without it `git check-ignore` stays silent for
 * any path already tracked in the index, so generated files that were committed
 * once (then later gitignored) would not be reported. We want the ignore *rules*
 * to decide, independent of tracking state.
 *
 * `core.excludesFile=<devNull>` scopes the result to the analyzed project's own
 * ignore rules: a developer's personal global gitignore must not change which
 * files deslop reports, otherwise the same project yields different findings on
 * different machines.
 *
 * `gitUnavailable` is true only when the `git` binary could not be launched
 * (e.g. not installed → `ENOENT`). A non-git directory is normal: git exits 128
 * and often closes stdin before reading it, which surfaces as an `EPIPE` on the
 * input write — that is reported as available-but-empty, not a failure. Every
 * failure still degrades to an empty set so callers never crash. Exit status 1
 * means "no matches", not an error.
 */
export const collectGitIgnoredPaths = (
  rootDirectory: string,
  candidatePaths: ReadonlyArray<string>,
): GitIgnoredPathsResult => {
  if (candidatePaths.length === 0) return { ignoredPaths: new Set(), gitUnavailable: false };

  const result = spawnSync(
    "git",
    ["-c", `core.excludesFile=${devNull}`, "check-ignore", "--no-index", "--stdin", "-z"],
    {
      cwd: rootDirectory,
      input: candidatePaths.join("\0"),
      encoding: "utf-8",
      maxBuffer: GIT_CHECK_IGNORE_MAX_BUFFER_BYTES,
    },
  );

  if (result.error) {
    const gitBinaryMissing = "code" in result.error && result.error.code === "ENOENT";
    return { ignoredPaths: new Set(), gitUnavailable: gitBinaryMissing };
  }

  if (result.status === null || result.status > 1) {
    return { ignoredPaths: new Set(), gitUnavailable: false };
  }

  const ignoredPaths = result.stdout.split("\0").filter((entry) => entry.length > 0);

  return { ignoredPaths: new Set(ignoredPaths), gitUnavailable: false };
};
