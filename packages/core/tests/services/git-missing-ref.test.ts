import * as Effect from "effect/Effect";
import { describe, expect, it } from "vite-plus/test";
import { Git } from "../../src/services/git.js";

describe("Git.diffSelection when the base ref is missing", () => {
  it("returns null when explicitBaseBranch does not exist (REACT-DOCTOR-1K)", async () => {
    const layer = Git.layerOf({
      currentBranch: "feature/x",
      branchExists: new Map([["main", false]]),
    });

    const selection = await Effect.runPromise(
      Effect.gen(function* () {
        const git = yield* Git;
        return yield* git.diffSelection({
          directory: "/repo",
          explicitBaseBranch: "main",
        });
      }).pipe(Effect.provide(layer)),
    );

    expect(selection).toBeNull();
  });

  it("returns null when a range endpoint does not exist (REACT-DOCTOR-1K)", async () => {
    const layer = Git.layerOf({
      currentBranch: "feature/x",
      branchExists: new Map([
        ["main", true],
        ["staging", false],
      ]),
    });

    const selection = await Effect.runPromise(
      Effect.gen(function* () {
        const git = yield* Git;
        return yield* git.diffSelection({
          directory: "/repo",
          explicitBaseBranch: "staging...main",
        });
      }).pipe(Effect.provide(layer)),
    );

    expect(selection).toBeNull();
  });

  it("returns null when HEAD endpoint in a range does not exist", async () => {
    const layer = Git.layerOf({
      currentBranch: "feature/x",
      branchExists: new Map([
        ["main", true],
        ["HEAD", false],
      ]),
    });

    const selection = await Effect.runPromise(
      Effect.gen(function* () {
        const git = yield* Git;
        return yield* git.diffSelection({
          directory: "/repo",
          explicitBaseBranch: "main..",
        });
      }).pipe(Effect.provide(layer)),
    );

    expect(selection).toBeNull();
  });
});
