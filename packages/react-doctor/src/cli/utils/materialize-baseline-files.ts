import * as Effect from "effect/Effect";
import {
  GIT_SHOW_MAX_BUFFER_BYTES,
  Git,
  type MaterializedTree,
  materializeSourceTree,
} from "@react-doctor/core";

/**
 * Materializes the `ref` version of `files` into `tempDirectory` (via
 * `git show <ref>:<path>`), mirroring the project layout + head's config files
 * so the base lints under the same rules as head. Reuses the shared,
 * zip-slip-guarded `materializeSourceTree`. Per-file read misses (e.g. a file
 * the PR added, absent at base) are skipped, which is exactly what we want:
 * a brand-new file has no base counterpart, so all its findings are "new".
 */
export const materializeBaselineFiles = (input: {
  directory: string;
  ref: string;
  files: ReadonlyArray<string>;
  tempDirectory: string;
}): Promise<MaterializedTree> =>
  Effect.runPromise(
    Effect.gen(function* () {
      const git = yield* Git;
      return yield* materializeSourceTree({
        directory: input.directory,
        files: input.files,
        tempDirectory: input.tempDirectory,
        readContent: (relativePath) =>
          git.showRefContent({
            directory: input.directory,
            ref: input.ref,
            relativePath,
            options: { maxBufferBytes: GIT_SHOW_MAX_BUFFER_BYTES },
          }),
      });
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
