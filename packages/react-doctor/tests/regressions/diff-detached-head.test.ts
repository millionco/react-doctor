/**
 * Regression for issue #298: `--diff <base>` silently fell back to a
 * full repo scan on GitHub Actions `pull_request` runs because
 * `actions/checkout@v4` leaves `HEAD` detached at `refs/pull/N/merge`.
 *
 * The original `getDiffInfo` short-circuited on detached HEAD even when
 * the caller had passed an explicit base branch — turning a one-file PR
 * into hundreds of unrelated findings.
 */

import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import { afterAll, describe, expect, it } from "vite-plus/test";

import { getDiffInfo } from "@react-doctor/core";
import { commitAll, initGitRepo, writeFile } from "./_helpers.js";

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rd-diff-detached-"));

afterAll(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

const buildPullRequestCheckoutFixture = (
  caseId: string,
): { repoDir: string; changedFilePath: string } => {
  const repoDir = path.join(tempRoot, caseId);
  fs.mkdirSync(repoDir, { recursive: true });

  writeFile(path.join(repoDir, "src", "app.tsx"), "export const App = () => null;\n");
  initGitRepo(repoDir);
  const baseCommitHash = commitAll(repoDir, "init");

  spawnSync("git", ["checkout", "-q", "-b", "feature"], { cwd: repoDir });
  const changedFilePath = "src/feature.tsx";
  writeFile(path.join(repoDir, changedFilePath), "export const Feature = () => null;\n");
  commitAll(repoDir, "add feature");

  // `actions/checkout@v4` on a `pull_request` event checks out the
  // merge ref in detached HEAD — reproduce that by detaching at the
  // feature commit and dropping the named branch.
  spawnSync("git", ["checkout", "-q", "--detach", "HEAD"], { cwd: repoDir });
  spawnSync("git", ["branch", "-q", "-D", "feature"], { cwd: repoDir });

  spawnSync("git", ["branch", "-q", "master", baseCommitHash], { cwd: repoDir });

  return { repoDir, changedFilePath };
};

describe("issue #298: --diff respects explicit base on detached HEAD", () => {
  it("returns the changed file when given an explicit base branch and HEAD is detached", async () => {
    const { repoDir, changedFilePath } = buildPullRequestCheckoutFixture("detached-with-base");

    // Sanity-check the fixture: `rev-parse --abbrev-ref HEAD` returns
    // the literal "HEAD" only when detached.
    const headRef = spawnSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
      cwd: repoDir,
      encoding: "utf-8",
    });
    expect(headRef.stdout.toString().trim()).toBe("HEAD");

    const diffInfo = await getDiffInfo(repoDir, "master");
    expect(diffInfo).not.toBeNull();
    expect(diffInfo?.baseBranch).toBe("master");
    expect(diffInfo?.currentBranch).toBeNull();
    expect(diffInfo?.changedFiles).toEqual([changedFilePath]);
  });

  it("still returns null on detached HEAD when no explicit base is given (cannot infer scope)", async () => {
    const { repoDir } = buildPullRequestCheckoutFixture("detached-no-base");
    await expect(getDiffInfo(repoDir)).resolves.toBeNull();
  });

  it("still throws the existing 'base does not exist' error on detached HEAD with a bogus base", async () => {
    const { repoDir } = buildPullRequestCheckoutFixture("detached-bogus-base");
    await expect(getDiffInfo(repoDir, "origin/does-not-exist")).rejects.toThrow(/does not exist/);
  });

  it("keeps the attached-HEAD path working when explicit base is given", async () => {
    const repoDir = path.join(tempRoot, "attached-with-base");
    fs.mkdirSync(repoDir, { recursive: true });
    writeFile(path.join(repoDir, "src", "app.tsx"), "export const App = () => null;\n");
    initGitRepo(repoDir);
    commitAll(repoDir, "init");

    spawnSync("git", ["checkout", "-q", "-b", "feature"], { cwd: repoDir });
    const changedFilePath = "src/feature.tsx";
    writeFile(path.join(repoDir, changedFilePath), "export const Feature = () => null;\n");
    commitAll(repoDir, "add feature");

    const diffInfo = await getDiffInfo(repoDir, "main");
    expect(diffInfo).not.toBeNull();
    expect(diffInfo?.currentBranch).toBe("feature");
    expect(diffInfo?.baseBranch).toBe("main");
    expect(diffInfo?.changedFiles).toEqual([changedFilePath]);
  });
});
