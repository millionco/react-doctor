import * as Effect from "effect/Effect";
import { isLintableSourceFile } from "./utils/is-lintable-source-file.js";
import { Git } from "./services/git.js";
import type { ChangedFileLineRanges, DiffInfo } from "./types/index.js";

/**
 * Programmatic façade over `Git.diffSelection`. Async because the
 * Git service runs through Effect's `ChildProcess` (true subprocess
 * spawn, not `spawnSync`).
 *
 * Failures propagate as the tagged `ReactDoctorError` (rejected by
 * `Effect.runPromise`) rather than being flattened into a plain
 * `Error`. The message is unchanged — `ReactDoctorError.message`
 * defers to `reason.message` — so message-matching callers keep
 * working, while the CLI can now dispatch on `error.reason._tag` to
 * render diff-base mistakes (`GitBaseBranchInvalid` /
 * `GitBaseBranchMissing`) as clean user errors instead of crashes.
 */
export const getDiffInfo = (
  directory: string,
  explicitBaseBranch?: string,
  includeUntracked?: boolean,
): Promise<DiffInfo | null> =>
  Effect.runPromise(
    Effect.gen(function* () {
      const git = yield* Git;
      const selection = yield* git.diffSelection({
        directory,
        explicitBaseBranch,
        includeUntracked,
      });
      if (selection === null) return null;
      return {
        currentBranch: selection.currentBranch,
        baseBranch: selection.baseBranch,
        ...(selection.diffBaseRef !== undefined ? { diffBaseRef: selection.diffBaseRef } : {}),
        changedFiles: [...selection.changedFiles],
        ...(selection.isCurrentChanges ? { isCurrentChanges: true } : {}),
      } satisfies DiffInfo;
    }).pipe(Effect.provide(Git.layerNode)),
  );

export const filterSourceFiles = (filePaths: string[]): string[] =>
  filePaths.filter(isLintableSourceFile);

/**
 * Programmatic façade over `Git.changedLineRanges` (the `lines` scope). Diffs
 * `files` with `--unified=0` against `baseRef` (or the index when `cached`),
 * returning per-file changed line ranges relative to `directory`. Returns
 * `null` when the ranges can't be computed (git unavailable / unsafe ref /
 * non-zero exit) so the caller degrades to file-level scope; an empty array
 * means git succeeded but the files added no lines.
 */
export const getChangedLineRanges = (input: {
  directory: string;
  baseRef?: string;
  cached?: boolean;
  files: ReadonlyArray<string>;
  includeUntracked?: boolean;
}): Promise<ChangedFileLineRanges[] | null> =>
  Effect.runPromise(
    Effect.gen(function* () {
      const git = yield* Git;
      const ranges = yield* git.changedLineRanges(input);
      return ranges === null
        ? null
        : ranges.map((entry) => ({ file: entry.file, ranges: entry.ranges }));
    }).pipe(Effect.provide(Git.layerNode)),
  );
