import os from "node:os";
import * as Effect from "effect/Effect";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { Git } from "@react-doctor/core";

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
    // Point PATH at a directory with no `git`, so spawning the binary fails
    // with ENOENT (PlatformError NotFound) — the same shape as running in a
    // bare container without git. The best-effort read must not throw.
    process.env.PATH = os.tmpdir() + "/react-doctor-no-git-on-path";

    const branch = await Effect.runPromise(
      Effect.gen(function* () {
        const git = yield* Git;
        return yield* git.currentBranch(os.tmpdir());
      }).pipe(Effect.provide(Git.layerNode)),
    );

    expect(branch).toBeNull();
  });
});
