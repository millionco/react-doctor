import * as Effect from "effect/Effect";
import { isLintableSourceFile } from "./utils/is-lintable-source-file.js";
import { Git } from "./services/git.js";
import type { DiffInfo } from "./types/index.js";

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
): Promise<DiffInfo | null> =>
  Effect.runPromise(
    Effect.gen(function* () {
      const git = yield* Git;
      const selection = yield* git.diffSelection({ directory, explicitBaseBranch });
      if (selection === null) return null;
      return {
        currentBranch: selection.currentBranch,
        baseBranch: selection.baseBranch,
        changedFiles: [...selection.changedFiles],
        ...(selection.isCurrentChanges ? { isCurrentChanges: true } : {}),
      } satisfies DiffInfo;
    }).pipe(Effect.provide(Git.layerNode)),
  );

export const filterSourceFiles = (filePaths: string[]): string[] =>
  filePaths.filter(isLintableSourceFile);
