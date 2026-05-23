import * as Effect from "effect/Effect";
import { SOURCE_FILE_PATTERN } from "./constants.js";
import { Git } from "./services/git.js";
import type { DiffInfo } from "./types/index.js";

/**
 * Programmatic façade over `Git.diffSelection`. Async because the
 * Git service runs through Effect's `ChildProcess` (true subprocess
 * spawn, not `spawnSync`).
 *
 * Tagged-reason errors are dispatched via `Effect.catchReasons`
 * (a v4-native API for narrowing inside a `Schema.TaggedErrorClass`
 * union without manual `instanceof` checks). The recovered branches
 * raise plain `Error`s so existing thrown-class consumers continue
 * to work — anything else (real `GitInvocationFailed`, etc.)
 * propagates as the tagged `ReactDoctorError` through `Effect.runPromise`.
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
    }).pipe(
      Effect.provide(Git.layerNode),
      Effect.catchReasons("ReactDoctorError", {
        GitBaseBranchInvalid: (reason) => Effect.die(new Error(reason.detail)),
        GitBaseBranchMissing: (reason) => Effect.die(new Error(reason.message)),
      }),
    ),
  );

export const filterSourceFiles = (filePaths: string[]): string[] =>
  filePaths.filter((filePath) => SOURCE_FILE_PATTERN.test(filePath));
