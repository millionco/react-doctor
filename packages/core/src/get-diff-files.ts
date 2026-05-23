import * as Effect from "effect/Effect";
import { SOURCE_FILE_PATTERN } from "./constants.js";
import { GitBaseBranchInvalid, GitBaseBranchMissing, ReactDoctorError } from "./errors.js";
import { Git, type GitDiffSelection } from "./services/git.js";
import type { DiffInfo } from "@react-doctor/types";

/**
 * Programmatic façade over `Git.diffSelection`. Async because the
 * Git service now runs through Effect's `ChildProcess` (true
 * subprocess spawn, not `spawnSync`).
 *
 * Errors are unwrapped back into the historical `Error` shape so
 * existing thrown-class consumers continue to work:
 *  - empty base branch → `Error("Diff base branch cannot be empty.")`
 *  - non-existent base → `Error('Diff base branch "X" does not exist ...')`
 *  - any other git failure → propagated cause via `Effect.runPromise`
 */
export const getDiffInfo = async (
  directory: string,
  explicitBaseBranch?: string,
): Promise<DiffInfo | null> => {
  let selection: GitDiffSelection | null;
  try {
    selection = await Effect.runPromise(
      Effect.gen(function* () {
        const git = yield* Git;
        return yield* git.diffSelection({ directory, explicitBaseBranch });
      }).pipe(Effect.provide(Git.layerNode)),
    );
  } catch (cause) {
    if (cause instanceof ReactDoctorError) {
      if (cause.reason instanceof GitBaseBranchInvalid) {
        throw new Error(cause.reason.detail);
      }
      if (cause.reason instanceof GitBaseBranchMissing) {
        throw new Error(cause.reason.message);
      }
    }
    throw cause;
  }

  if (selection === null) return null;
  return {
    currentBranch: selection.currentBranch,
    baseBranch: selection.baseBranch,
    changedFiles: [...selection.changedFiles],
    ...(selection.isCurrentChanges ? { isCurrentChanges: true } : {}),
  };
};

export const filterSourceFiles = (filePaths: string[]): string[] =>
  filePaths.filter((filePath) => SOURCE_FILE_PATTERN.test(filePath));
