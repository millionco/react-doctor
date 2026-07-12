import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import { afterAll, describe, expect, it } from "vite-plus/test";

import { getChangedLineRanges, getDiffInfo } from "@react-doctor/core";
import { commitAll, initGitRepo, writeFile } from "./_helpers.js";

const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rd-untracked-scope-"));

afterAll(() => {
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
});

const createRepository = (caseId: string): string => {
  const repositoryDirectory = path.join(temporaryRoot, caseId);
  fs.mkdirSync(repositoryDirectory, { recursive: true });
  writeFile(path.join(repositoryDirectory, ".gitignore"), "src/ignored.tsx\n");
  writeFile(path.join(repositoryDirectory, "src/app.tsx"), "export const App = () => null;\n");
  initGitRepo(repositoryDirectory);
  commitAll(repositoryDirectory, "init");
  return repositoryDirectory;
};

const sorted = (filePaths: ReadonlyArray<string> | undefined): string[] =>
  [...(filePaths ?? [])].sort();

describe("working-tree change scopes include untracked files", () => {
  it("includes ordinary untracked files and excludes ignored files on the default branch", async () => {
    const repositoryDirectory = createRepository("default-branch");
    writeFile(
      path.join(repositoryDirectory, "src/new.tsx"),
      "export const New = () => <button>Save</button>;\n",
    );
    writeFile(
      path.join(repositoryDirectory, "src/ignored.tsx"),
      "export const Ignored = () => <button>Ignore</button>;\n",
    );

    const diffInfo = await getDiffInfo(repositoryDirectory);

    expect(diffInfo?.isCurrentChanges).toBe(true);
    expect(sorted(diffInfo?.changedFiles)).toEqual(["src/new.tsx"]);
  });

  it("combines tracked and untracked changes on a feature branch", async () => {
    const repositoryDirectory = createRepository("feature-branch");
    execFileSync("git", ["checkout", "-q", "-b", "feature"], { cwd: repositoryDirectory });
    writeFile(
      path.join(repositoryDirectory, "src/app.tsx"),
      "export const App = () => <button>Save</button>;\n",
    );
    writeFile(
      path.join(repositoryDirectory, "src/new.tsx"),
      "export const New = () => <button>Save</button>;\n",
    );

    const diffInfo = await getDiffInfo(repositoryDirectory, "main");

    expect(sorted(diffInfo?.changedFiles)).toEqual(["src/app.tsx", "src/new.tsx"]);
  });

  it("treats every line in an untracked file as new without widening explicit commit ranges", async () => {
    const repositoryDirectory = createRepository("line-and-range");
    const baseSha = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: repositoryDirectory,
      encoding: "utf8",
    }).trim();
    writeFile(
      path.join(repositoryDirectory, "src/tracked.tsx"),
      "export const Tracked = () => <button>Save</button>;\n",
    );
    const headSha = commitAll(repositoryDirectory, "add tracked file");
    writeFile(
      path.join(repositoryDirectory, "src/new.tsx"),
      "export const New = () => (\n  <button>Save</button>\n);\n",
    );

    const workingTreeDiff = await getDiffInfo(repositoryDirectory, baseSha);
    const lineRanges = await getChangedLineRanges({
      directory: repositoryDirectory,
      baseRef: baseSha,
      files: [...(workingTreeDiff?.changedFiles ?? [])],
    });
    const explicitRange = await getDiffInfo(repositoryDirectory, `${baseSha}..${headSha}`);

    expect(sorted(workingTreeDiff?.changedFiles)).toEqual(["src/new.tsx", "src/tracked.tsx"]);
    expect(lineRanges).toContainEqual({
      file: "src/new.tsx",
      ranges: [[1, Number.MAX_SAFE_INTEGER]],
    });
    expect(sorted(explicitRange?.changedFiles)).toEqual(["src/tracked.tsx"]);
  });

  it("preserves staged selection and exact staged line ranges", async () => {
    const repositoryDirectory = createRepository("staged");
    writeFile(
      path.join(repositoryDirectory, "src/staged.tsx"),
      "export const Staged = () => <button>Save</button>;\n",
    );
    execFileSync("git", ["add", "src/staged.tsx"], { cwd: repositoryDirectory });

    const lineRanges = await getChangedLineRanges({
      directory: repositoryDirectory,
      cached: true,
      files: ["src/staged.tsx"],
    });

    expect(lineRanges).toEqual([{ file: "src/staged.tsx", ranges: [[1, 1]] }]);
  });
});
