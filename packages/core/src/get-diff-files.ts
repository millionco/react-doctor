import * as Effect from "effect/Effect";
import { SOURCE_FILE_PATTERN } from "./constants.js";
import { GitBaseBranchInvalid, GitBaseBranchMissing, ReactDoctorError } from "./errors.js";
import { Git, type GitDiffSelection } from "./services/git.js";
import type { DiffInfo } from "@react-doctor/types";

/**
 * Legacy synchronous façade. New callers should pull the `Git`
 * service directly via `yield* Git` inside their own Effect rather
 * than going through this wrapper — it exists so the existing CLI
 * code paths that aren't yet Effect-typed don't need to change.
 *
 * Errors are unwrapped back into the historical `Error` shape:
 *  - empty base branch → `Error("Diff base branch cannot be empty.")`
 *  - non-existent base → `Error('Diff base branch "X" does not exist (run \`git fetch\` to update remote refs).')`
 *  - any other git failure → propagated cause
 */
export const getDiffInfo = (directory: string, explicitBaseBranch?: string): DiffInfo | null => {
  const program = Effect.gen(function* () {
    const git = yield* Git;
    return yield* git.diffSelection({ directory, explicitBaseBranch });
  });

  let selection: GitDiffSelection | null;
  try {
    selection = runProgram(program);
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

const runProgram = <Value>(program: Effect.Effect<Value, ReactDoctorError, Git>): Value =>
  Effect.runSync(program.pipe(Effect.provide(Git.layerNode)));

export const filterSourceFiles = (filePaths: string[]): string[] =>
  filePaths.filter((filePath) => SOURCE_FILE_PATTERN.test(filePath));
