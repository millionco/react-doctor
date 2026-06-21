import os from "node:os";
import * as Effect from "effect/Effect";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { Git } from "../../src/services/git.js";

const originalPath = process.env.PATH;

const restorePath = (): void => {
  if (originalPath === undefined) {
    delete process.env.PATH;
    return;
  }
  process.env.PATH = originalPath;
};

describe("Git.layerNode when the git binary is unavailable", () => {
  afterEach(restorePath);

  it("degrades currentBranch to null instead of crashing the scan (REACT-DOCTOR-F)", async () => {
    process.env.PATH = os.tmpdir() + "/react-doctor-no-git-on-path";

    const branch = await Effect.runPromise(
      Effect.gen(function* () {
        const git = yield* Git;
        return yield* git.currentBranch(os.tmpdir());
      }).pipe(Effect.provide(Git.layerNode)),
    );

    expect(branch).toBeNull();
  });

  it("degrades branchExists to false when git is unavailable (REACT-DOCTOR-F)", async () => {
    process.env.PATH = os.tmpdir() + "/react-doctor-no-git-on-path";

    const exists = await Effect.runPromise(
      Effect.gen(function* () {
        const git = yield* Git;
        return yield* git.branchExists(os.tmpdir(), "main");
      }).pipe(Effect.provide(Git.layerNode)),
    );

    expect(exists).toBe(false);
  });

  it("throws GitBaseBranchMissing when git is unavailable and explicit base is provided (REACT-DOCTOR-F)", async () => {
    process.env.PATH = os.tmpdir() + "/react-doctor-no-git-on-path";

    await expect(
      Effect.runPromise(
        Effect.gen(function* () {
          const git = yield* Git;
          return yield* git.diffSelection({
            directory: os.tmpdir(),
            explicitBaseBranch: "main",
          });
        }).pipe(Effect.provide(Git.layerNode)),
      ),
    ).rejects.toThrow(/does not exist/);
  });

  it("throws GitBaseBranchMissing when git is unavailable for range syntax (REACT-DOCTOR-F)", async () => {
    process.env.PATH = os.tmpdir() + "/react-doctor-no-git-on-path";

    await expect(
      Effect.runPromise(
        Effect.gen(function* () {
          const git = yield* Git;
          return yield* git.diffSelection({
            directory: os.tmpdir(),
            explicitBaseBranch: "main...feature",
          });
        }).pipe(Effect.provide(Git.layerNode)),
      ),
    ).rejects.toThrow(/does not exist/);
  });
});
