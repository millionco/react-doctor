import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import fs from "node:fs";
import path from "node:path";
import {
  GIT_SHOW_MAX_BUFFER_BYTES,
  SOURCE_FILE_PATTERN,
  STAGED_FILES_PROJECT_CONFIG_FILENAMES,
} from "../constants.js";
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
     * Discovers source files staged for commit (`SOURCE_FILE_PATTERN`-filtered
     * staged paths from `git diff --cached`).
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
          git
            .stagedFilePaths(directory)
            .pipe(
              Effect.map((entries) => entries.filter((entry) => SOURCE_FILE_PATTERN.test(entry))),
            ),
        materialize: ({ directory, stagedFiles, tempDirectory }) =>
          Effect.gen(function* () {
            const materializedFiles: string[] = [];
            for (const relativePath of stagedFiles) {
              // Per-file git failures (missing binary, buffer overflow,
              // spawn errors) must NOT sink the whole snapshot — the
              // legacy helper caught these and skipped the path so the
              // staged scan kept going with whatever files did read
              // cleanly. Fold ReactDoctorError to `null` so the same
              // skip-and-continue behavior holds.
              const content = yield* git
                .showStagedContent(directory, relativePath, {
                  maxBufferBytes: GIT_SHOW_MAX_BUFFER_BYTES,
                })
                .pipe(Effect.orElseSucceed(() => null as string | null));
              if (content === null) continue;
              const targetPath = path.join(tempDirectory, relativePath);
              yield* Effect.sync(() => {
                fs.mkdirSync(path.dirname(targetPath), { recursive: true });
                fs.writeFileSync(targetPath, content);
              });
              materializedFiles.push(relativePath);
            }
            yield* Effect.sync(() => {
              for (const configFilename of STAGED_FILES_PROJECT_CONFIG_FILENAMES) {
                const sourcePath = path.join(directory, configFilename);
                const targetPath = path.join(tempDirectory, configFilename);
                if (fs.existsSync(sourcePath) && !fs.existsSync(targetPath)) {
                  fs.cpSync(sourcePath, targetPath);
                }
              }
            });
            return {
              tempDirectory,
              stagedFiles: materializedFiles,
              cleanup: () => {
                try {
                  fs.rmSync(tempDirectory, { recursive: true, force: true });
                } catch {
                  // Best-effort cleanup; OS tempdir reapers eventually run.
                }
              },
            } satisfies StagedSnapshot;
          }),
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
