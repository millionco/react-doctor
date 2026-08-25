import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import { afterAll, describe, expect, it } from "vite-plus/test";

import { getDiffInfo } from "@react-doctor/core";
import { commitAll, initGitRepo, writeFile } from "./_helpers.js";

const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rd-issue-1674-"));

afterAll(() => {
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
});

const buildRepositoryWithRemoteDefaultBranch = (caseId: string): string => {
  const repositoryDirectory = path.join(temporaryRoot, caseId);
  writeFile(path.join(repositoryDirectory, "src", "app.tsx"), "export const App = () => null;\n");
  initGitRepo(repositoryDirectory);
  commitAll(repositoryDirectory, "initial commit");
  spawnSync("git", ["remote", "add", "origin", "https://github.com/test/repository.git"], {
    cwd: repositoryDirectory,
  });
  spawnSync("git", ["update-ref", "refs/remotes/origin/main", "HEAD"], {
    cwd: repositoryDirectory,
  });
  spawnSync("git", ["symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main"], {
    cwd: repositoryDirectory,
  });
  return repositoryDirectory;
};

describe("issue #1674: changed scope uses the remote default branch", () => {
  it("detects committed feature changes without a local default branch", async () => {
    const repositoryDirectory = buildRepositoryWithRemoteDefaultBranch("feature-without-main");
    spawnSync("git", ["checkout", "-q", "-b", "feature"], { cwd: repositoryDirectory });
    spawnSync("git", ["branch", "-q", "-D", "main"], { cwd: repositoryDirectory });
    writeFile(
      path.join(repositoryDirectory, "src", "feature.tsx"),
      "export const Feature = () => null;\n",
    );
    commitAll(repositoryDirectory, "add feature");

    const diffInfo = await getDiffInfo(repositoryDirectory);

    expect(diffInfo).toMatchObject({
      baseBranch: "origin/main",
      changedFiles: ["src/feature.tsx"],
      currentBranch: "feature",
    });
    expect(diffInfo?.isCurrentChanges).toBeUndefined();
  });

  it("detects committed changes when local main is ahead of origin/main", async () => {
    const repositoryDirectory = buildRepositoryWithRemoteDefaultBranch("main-ahead");
    writeFile(
      path.join(repositoryDirectory, "src", "local-change.tsx"),
      "export const LocalChange = () => null;\n",
    );
    commitAll(repositoryDirectory, "add local change");

    const diffInfo = await getDiffInfo(repositoryDirectory);

    expect(diffInfo).toMatchObject({
      baseBranch: "origin/main",
      changedFiles: ["src/local-change.tsx"],
      currentBranch: "main",
    });
    expect(diffInfo?.isCurrentChanges).toBeUndefined();
  });
});
