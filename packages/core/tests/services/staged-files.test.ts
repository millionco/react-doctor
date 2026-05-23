import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { Git, GitInvocationFailed, ReactDoctorError, StagedFiles } from "@react-doctor/core";

describe("StagedFiles.layerNode (driven by Git.layerOf)", () => {
  it("filters staged files through SOURCE_FILE_PATTERN", async () => {
    const layer = StagedFiles.layerNode.pipe(
      Layer.provide(
        Git.layerOf({
          stagedFiles: ["src/a.ts", "README.md", "src/b.tsx", "package.json"],
        }),
      ),
    );

    const sourceFiles = await Effect.runPromise(
      Effect.gen(function* () {
        const staged = yield* StagedFiles;
        return yield* staged.discoverSourceFiles("/repo");
      }).pipe(Effect.provide(layer)),
    );

    expect(sourceFiles).toEqual(["src/a.ts", "src/b.tsx"]);
  });

  it("returns an empty list when no files are staged", async () => {
    const layer = StagedFiles.layerNode.pipe(Layer.provide(Git.layerOf({ stagedFiles: [] })));

    const sourceFiles = await Effect.runPromise(
      Effect.gen(function* () {
        const staged = yield* StagedFiles;
        return yield* staged.discoverSourceFiles("/repo");
      }).pipe(Effect.provide(layer)),
    );

    expect(sourceFiles).toEqual([]);
  });
});

describe("StagedFiles.layerNode regression — per-file git failures", () => {
  let tempDirectory: string;

  beforeEach(() => {
    tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "rd-staged-test-"));
  });

  afterEach(() => {
    fs.rmSync(tempDirectory, { recursive: true, force: true });
  });

  /**
   * Bugbot regression (#431): if Git.showStagedContent raises (e.g.
   * git missing, buffer overflow), the legacy helper swallowed it
   * and skipped the file. StagedFiles.materialize must preserve that
   * skip-and-continue behavior — never sink the whole snapshot.
   */
  it("skips files when git.showStagedContent raises and keeps materializing the rest", async () => {
    const failingShowStagedGit = Layer.succeed(
      Git,
      Git.of({
        currentBranch: () => Effect.succeed(null),
        defaultBranch: () => Effect.succeed(null),
        branchExists: () => Effect.succeed(false),
        diffSelection: () => Effect.succeed(null),
        stagedFilePaths: () => Effect.succeed(["src/a.ts", "src/b.ts"]),
        showStagedContent: (_directory, relativePath) => {
          if (relativePath === "src/a.ts") {
            return Effect.fail(
              new ReactDoctorError({
                reason: new GitInvocationFailed({
                  args: ["show", `:${relativePath}`],
                  directory: "/repo",
                  cause: new Error("simulated git missing"),
                }),
              }),
            );
          }
          return Effect.succeed("export const b = 1;\n");
        },
        grep: () => Effect.succeed(null),
      } satisfies Context.Tag.Service<typeof Git>),
    );

    const layer = StagedFiles.layerNode.pipe(Layer.provide(failingShowStagedGit));

    const snapshot = await Effect.runPromise(
      Effect.gen(function* () {
        const staged = yield* StagedFiles;
        return yield* staged.materialize({
          directory: "/repo",
          stagedFiles: ["src/a.ts", "src/b.ts"],
          tempDirectory,
        });
      }).pipe(Effect.provide(layer)),
    );

    expect(snapshot.stagedFiles).toEqual(["src/b.ts"]);
    expect(fs.existsSync(path.join(tempDirectory, "src/b.ts"))).toBe(true);
    expect(fs.existsSync(path.join(tempDirectory, "src/a.ts"))).toBe(false);
  });
});

describe("StagedFiles.layerOf (deterministic test layer)", () => {
  it("returns the snapshot's source files unchanged", async () => {
    const layer = StagedFiles.layerOf({
      sourceFiles: ["src/a.ts", "src/b.tsx"],
    });

    const sourceFiles = await Effect.runPromise(
      Effect.gen(function* () {
        const staged = yield* StagedFiles;
        return yield* staged.discoverSourceFiles("/repo");
      }).pipe(Effect.provide(layer)),
    );

    expect(sourceFiles).toEqual(["src/a.ts", "src/b.tsx"]);
  });

  it("returns a no-op cleanup snapshot from materialize()", async () => {
    const layer = StagedFiles.layerOf({
      sourceFiles: ["src/a.ts"],
      materializedFiles: ["src/a.ts"],
    });

    const snapshot = await Effect.runPromise(
      Effect.gen(function* () {
        const staged = yield* StagedFiles;
        return yield* staged.materialize({
          directory: "/repo",
          stagedFiles: ["src/a.ts"],
          tempDirectory: "/tmp/snap",
        });
      }).pipe(Effect.provide(layer)),
    );

    expect(snapshot.tempDirectory).toBe("/tmp/snap");
    expect(snapshot.stagedFiles).toEqual(["src/a.ts"]);
    expect(typeof snapshot.cleanup).toBe("function");
    expect(() => snapshot.cleanup()).not.toThrow();
  });
});
