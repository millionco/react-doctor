import * as Effect from "effect/Effect";
import {
  GIT_SHOW_MAX_BUFFER_BYTES,
  Git,
  type MaterializedTree,
  materializeSourceTree,
} from "@react-doctor/core";
import { isMaterializableGitSource } from "./is-materializable-git-source.js";

export interface BaselineMaterializedTree extends MaterializedTree {
  readonly baseFiles: ReadonlyArray<string>;
  readonly headFiles: ReadonlyArray<string>;
  readonly isComplete: boolean;
  readonly untrackedFiles: ReadonlyArray<string>;
}

/**
 * Materializes the base side of the `ref` → worktree diff into
 * `tempDirectory`, mirroring the project layout plus head's config files so
 * both sides lint under the same rules. Git rename heuristics are disabled by
 * the diff planner, so an old path is retained as a base deletion while its
 * new path is a head addition. Missing head-only additions are expected;
 * missing paths that the plan says must exist at base make `isComplete` false.
 */
export const materializeBaselineFiles = (input: {
  directory: string;
  ref: string;
  files: ReadonlyArray<string>;
  baseFiles?: ReadonlyArray<string>;
  headFiles?: ReadonlyArray<string>;
  tempDirectory: string;
}): Promise<BaselineMaterializedTree | null> =>
  Effect.runPromise(
    Effect.gen(function* () {
      const git = yield* Git;
      const diffPlan = yield* git.baselineDiffPlan({
        directory: input.directory,
        ref: input.ref,
      });
      const baseFiles = input.baseFiles ?? diffPlan?.baseFiles;
      const headFiles = input.headFiles ?? diffPlan?.headFiles;
      const untrackedFiles = diffPlan?.untrackedFiles ?? [];
      if (baseFiles === undefined || headFiles === undefined) return null;
      const files = [...new Set([...input.files, ...baseFiles])];
      const tree = yield* materializeSourceTree({
        directory: input.directory,
        files,
        tempDirectory: input.tempDirectory,
        readContent: (relativePath) =>
          git
            .showRefContent({
              directory: input.directory,
              ref: input.ref,
              relativePath,
              options: { maxBufferBytes: GIT_SHOW_MAX_BUFFER_BYTES },
            })
            .pipe(
              Effect.map((content) =>
                content !== null && isMaterializableGitSource(content) ? content : null,
              ),
            ),
      });
      const materializedFiles = new Set(tree.materializedFiles);
      return {
        ...tree,
        baseFiles,
        headFiles,
        isComplete: baseFiles.every((filePath) => materializedFiles.has(filePath)),
        untrackedFiles,
      } satisfies BaselineMaterializedTree;
    }).pipe(Effect.provide(Git.layerNode)),
  );

/**
 * Resolves the commit a baseline scan should read base content from — the
 * merge-base of `ref` and HEAD, so "introduced" is measured against the branch
 * point. `null` when unresolvable (ref missing/unsafe, no merge-base).
 */
export const resolveMergeBaseRef = async (
  directory: string,
  ref: string,
): Promise<string | null> => {
  try {
    return await Effect.runPromise(
      Effect.gen(function* () {
        const git = yield* Git;
        return yield* git.mergeBase({ directory, ref });
      }).pipe(Effect.provide(Git.layerNode)),
    );
  } catch {
    return null;
  }
};
