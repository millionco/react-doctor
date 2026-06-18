import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { collectGitIgnoredPaths } from "../src/utils/collect-git-ignored-paths.js";
import { toPosixPath } from "../src/utils/to-posix-path.js";

const createTempProject = (): string => mkdtempSync(join(tmpdir(), "deslop-gitignore-"));

const candidatePath = (projectDir: string, relativePath: string): string =>
  toPosixPath(resolve(projectDir, relativePath));

describe("collectGitIgnoredPaths", () => {
  it("returns only the gitignored subset of the given paths inside a git work tree", () => {
    const projectDir = createTempProject();
    try {
      execFileSync("git", ["init", "-q"], { cwd: projectDir });
      writeFileSync(join(projectDir, ".gitignore"), "generated/\n");
      mkdirSync(join(projectDir, "generated"));
      writeFileSync(join(projectDir, "generated", "output.ts"), "export const generated = 1;\n");
      writeFileSync(join(projectDir, "index.ts"), "export const entry = 2;\n");

      const ignoredPath = candidatePath(projectDir, "generated/output.ts");
      const keptPath = candidatePath(projectDir, "index.ts");
      const result = collectGitIgnoredPaths(projectDir, [ignoredPath, keptPath]);

      assert.equal(result.gitUnavailable, false);
      assert.ok(result.ignoredPaths.has(ignoredPath), "gitignored file should be reported");
      assert.ok(!result.ignoredPaths.has(keptPath), "non-ignored source must not be reported");
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it("treats a non-git directory as available-but-empty, not a git failure", () => {
    const projectDir = createTempProject();
    try {
      writeFileSync(join(projectDir, "index.ts"), "export const entry = 2;\n");
      const result = collectGitIgnoredPaths(projectDir, [candidatePath(projectDir, "index.ts")]);

      assert.equal(result.gitUnavailable, false);
      assert.equal(result.ignoredPaths.size, 0);
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });
});
