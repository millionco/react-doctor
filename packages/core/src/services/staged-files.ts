import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { GIT_SHOW_MAX_BUFFER_BYTES } from "../constants.js";
import { isLintableSourceFile } from "../utils/is-lintable-source-file.js";
import { materializeSourceTree } from "../materialize-source-tree.js";
import { ReactDoctorError } from "../errors.js";
import { Git } from "./git.js";

export interface StagedSnapshot {
  readonly tempDirectory: string;
  readonly stagedFiles: ReadonlyArray<string>;
  readonly cleanup: () => void;
}

/**
 * `StagedFiles` materializes the git-staged source files of a
 * directory into a temp tree (mirroring the project layout and
 * carrying over a fixed set of project config files) so oxlint can
 * lint the staged content without disturbing the working tree.
 *
 * Discovery and content extraction are delegated to the `Git`
 * service; materialization is plain filesystem IO inside the service
 * so a future `FileSystem` service can swap it. `layerNode` is the
 * production layer; `layerOf({ ... })` wires a deterministic
 * snapshot (no git, no fs) for tests.
 */
export class StagedFiles extends Context.Service<
  StagedFiles,
  {
    /**
     * Discovers source files staged for commit (lintable staged paths
     * from `git diff --cached` — JS/TS minus generated bundles).
     */
    readonly discoverSourceFiles: (
      directory: string,
    ) => Effect.Effect<ReadonlyArray<string>, ReactDoctorError>;
    /**
     * Materializes the supplied staged files into `tempDirectory`,
     * preserving the project layout and the well-known project config
     * files (`tsconfig.json`, `package.json`, …). Returns the snapshot
     * handle the caller should use to point the linter and to clean
     * up afterwards.
     */
    readonly materialize: (input: {
      readonly directory: string;
      readonly stagedFiles: ReadonlyArray<string>;
      readonly tempDirectory: string;
    }) => Effect.Effect<StagedSnapshot, ReactDoctorError>;
  }
>()("react-doctor/StagedFiles") {
  static readonly layerNode: Layer.Layer<StagedFiles, never, Git> = Layer.effect(
    StagedFiles,
    Effect.gen(function* () {
      const git = yield* Git;
      return StagedFiles.of({
        discoverSourceFiles: (directory) =>
          git.stagedFilePaths(directory).pipe(
            Effect.map((entries) => entries.filter(isLintableSourceFile)),
            Effect.withSpan("StagedFiles.discoverSourceFiles"),
          ),
        materialize: ({ directory, stagedFiles, tempDirectory }) =>
          // Per-file git failures (missing binary, buffer overflow, spawn
          // errors) must NOT sink the whole snapshot — `materializeSourceTree`
          // folds each read failure to `null` and skips that path, so the
          // staged scan keeps going with whatever read cleanly.
          materializeSourceTree({
            directory,
            files: stagedFiles,
            tempDirectory,
            readContent: (relativePath) =>
              git.showStagedContent(directory, relativePath, {
                maxBufferBytes: GIT_SHOW_MAX_BUFFER_BYTES,
              }),
          }).pipe(
            Effect.map(
              (tree) =>
                ({
                  tempDirectory: tree.tempDirectory,
                  stagedFiles: tree.materializedFiles,
                  cleanup: tree.cleanup,
                }) satisfies StagedSnapshot,
            ),
            Effect.withSpan("StagedFiles.materialize"),
          ),
      });
    }),
  );

  /**
   * Test layer: no git, no filesystem. The snapshot decides what
   * `discoverSourceFiles` returns and what `materialize` reports
   * (it never actually writes anywhere).
   */
  static readonly layerOf = (snapshot: {
    readonly sourceFiles?: ReadonlyArray<string>;
    readonly materializedFiles?: ReadonlyArray<string>;
  }): Layer.Layer<StagedFiles> =>
    Layer.succeed(
      StagedFiles,
      StagedFiles.of({
        discoverSourceFiles: () => Effect.succeed(snapshot.sourceFiles ?? []),
        materialize: ({ tempDirectory }) =>
          Effect.succeed({
            tempDirectory,
            stagedFiles: snapshot.materializedFiles ?? snapshot.sourceFiles ?? [],
            cleanup: () => {
              /* test snapshot does not own any disk state */
            },
          } satisfies StagedSnapshot),
      }),
    );
}
