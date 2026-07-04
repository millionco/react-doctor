import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as Effect from "effect/Effect";
import { afterAll, describe, expect, it } from "vite-plus/test";
import { Git } from "@react-doctor/core";

/**
 * Regression for #1064: `--staged` silently scanned nothing when the project
 * is a subdirectory of the git repo (the standard monorepo layout). Staged
 * paths are collected with `git diff --cached --relative` (project-relative,
 * e.g. `src/Bad.tsx`), but the content read used a bare `git show :<path>`
 * index pathspec — which git resolves against the REPO ROOT, not the cwd. In a
 * subproject that misses (`fatal: path 'apps/webui/src/Bad.tsx' is in the
 * index, but not 'src/Bad.tsx'`), the non-zero exit folds to `null`, and
 * `materializeSourceTree` skips the file with no warning, so every staged file
 * is dropped and the gate "passes" with `scannedFileCount: 0`.
 *
 * The fix prefixes the pathspec with `./` (`git show :./<path>`) so git
 * resolves it relative to the scanned project — the same treatment
 * `showRefContent` already applies to the `<ref>:<path>` baseline reads.
 *
 * Uses `Git.layerNode` (production layer) against a real repo whose project
 * lives in `apps/webui/`; staging (`git add`) populates the index, so the read
 * needs no commit (and thus no `commit.gpgsign` TTY prompt).
 */
const runNode = <Value>(program: Effect.Effect<Value, unknown, Git>): Promise<Value> =>
  Effect.runPromise(program.pipe(Effect.provide(Git.layerNode)));

const subdirectoryRepository = (() => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rd-1064-"));
  const projectDirectory = path.join(repoRoot, "apps", "webui");
  fs.mkdirSync(path.join(projectDirectory, "src"), { recursive: true });
  fs.writeFileSync(
    path.join(projectDirectory, "src", "Bad.tsx"),
    "export const Bad = () => <div>bad</div>;\n",
  );
  const runGit = (args: ReadonlyArray<string>): void => {
    execFileSync("git", [...args], { cwd: repoRoot, stdio: "ignore" });
  };
  runGit(["init"]);
  runGit(["add", "apps/webui/src/Bad.tsx"]);
  return { repoRoot, projectDirectory };
})();

afterAll(() => fs.rmSync(subdirectoryRepository.repoRoot, { recursive: true, force: true }));

describe("issue #1064: staged content reads from a project subdirectory", () => {
  it("reads a staged file whose path is relative to the scanned subproject", async () => {
    const content = await runNode(
      Effect.gen(function* () {
        const git = yield* Git;
        return yield* git.showStagedContent(subdirectoryRepository.projectDirectory, "src/Bad.tsx");
      }),
    );
    // Before the fix this was `null` (bare `:src/Bad.tsx` missed against the
    // repo root), silently dropping every staged file in a monorepo subproject.
    expect(content).toBe("export const Bad = () => <div>bad</div>;\n");
  });

  it("still returns null for a path genuinely absent from the index", async () => {
    const content = await runNode(
      Effect.gen(function* () {
        const git = yield* Git;
        return yield* git.showStagedContent(
          subdirectoryRepository.projectDirectory,
          "src/Missing.tsx",
        );
      }),
    );
    expect(content).toBeNull();
  });
});
