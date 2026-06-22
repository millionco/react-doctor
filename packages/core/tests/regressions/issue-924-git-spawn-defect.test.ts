import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as Effect from "effect/Effect";
import { afterAll, describe, expect, it } from "vite-plus/test";
import { Git } from "@react-doctor/core";

/**
 * Regression for REACT-DOCTOR-1E / 1P / 20: a `child_process.spawn` that fails
 * synchronously — ENAMETOOLONG (over-long argv on a large `--scope lines`
 * diff), ENOTDIR (a non-directory cwd), Windows UNKNOWN — throws *before* the
 * 'error' event, so the failure escapes Effect's typed channel as a defect and
 * crashed the whole scan (and reported to Sentry) instead of degrading.
 *
 * Pointing a Git call's `directory` at a file is a deterministic,
 * cross-platform way to make `spawn(..., { cwd })` throw `ENOTDIR`
 * synchronously — the exact 1P shape. After the fix every git path folds the
 * defect into `GitInvocationFailed` and degrades: no branch, no line ranges,
 * branch-absent — never a rejection.
 */
const runNode = <Value>(program: Effect.Effect<Value, unknown, Git>): Promise<Value> =>
  Effect.runPromise(program.pipe(Effect.provide(Git.layerNode)));

const fileAsDirectory = (() => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "rd-924-"));
  const filePath = path.join(root, "not-a-directory");
  fs.writeFileSync(filePath, "i am a file, not a directory");
  return { root, filePath };
})();

afterAll(() => fs.rmSync(fileAsDirectory.root, { recursive: true, force: true }));

describe("issue #924: a synchronous git spawn failure degrades instead of crashing", () => {
  it("currentBranch returns null when the spawn throws ENOTDIR", async () => {
    const branch = await runNode(
      Effect.gen(function* () {
        const git = yield* Git;
        return yield* git.currentBranch(fileAsDirectory.filePath);
      }),
    );
    expect(branch).toBeNull();
  });

  it("branchExists returns false when the spawn throws ENOTDIR", async () => {
    const exists = await runNode(
      Effect.gen(function* () {
        const git = yield* Git;
        return yield* git.branchExists(fileAsDirectory.filePath, "main");
      }),
    );
    expect(exists).toBe(false);
  });

  it("changedLineRanges returns null (degrade to file scope) when the spawn throws ENOTDIR", async () => {
    const ranges = await runNode(
      Effect.gen(function* () {
        const git = yield* Git;
        return yield* git.changedLineRanges({
          directory: fileAsDirectory.filePath,
          files: ["src/App.tsx"],
        });
      }),
    );
    expect(ranges).toBeNull();
  });

  it("changedLineRanges returns null when the file pathspecs would overflow the argv limit", async () => {
    // ~2000 nested paths blow past the OS command-line limit (the original
    // `--scope lines` ENAMETOOLONG on a 1k+-file Windows diff); the pre-flight
    // degrades to file scope instead of letting git's spawn throw. The
    // directory is real, so only the argv-length guard fires.
    const manyFiles = Array.from(
      { length: 2000 },
      (_, index) => `src/${"deeply/nested/".repeat(4)}file-${index}.tsx`,
    );
    const ranges = await runNode(
      Effect.gen(function* () {
        const git = yield* Git;
        return yield* git.changedLineRanges({ directory: fileAsDirectory.root, files: manyFiles });
      }),
    );
    expect(ranges).toBeNull();
  });
});
