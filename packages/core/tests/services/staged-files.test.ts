import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { describe, expect, it } from "vite-plus/test";
import { Git, StagedFiles } from "@react-doctor/core";

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
