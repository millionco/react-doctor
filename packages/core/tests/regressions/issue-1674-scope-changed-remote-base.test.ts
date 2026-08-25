import { exec as execCallback } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { getDiffInfo } from "../../src/get-diff-files.js";

const exec = promisify(execCallback);

describe("issue #1674: --scope changed should detect commits relative to remote base", () => {
  let testDirectory: string;

  beforeEach(async () => {
    testDirectory = await fs.promises.mkdtemp(path.join(os.tmpdir(), "react-doctor-test-"));
  });

  afterEach(async () => {
    if (testDirectory) {
      await fs.promises.rm(testDirectory, { recursive: true, force: true });
    }
  });

  it("detects committed changes on feature branch when local main doesn't exist", async () => {
    await exec("git init", { cwd: testDirectory });
    await exec('git config user.email "test@example.com"', { cwd: testDirectory });
    await exec('git config user.name "Test User"', { cwd: testDirectory });

    await fs.promises.writeFile(path.join(testDirectory, "initial.txt"), "initial content");
    await exec("git add .", { cwd: testDirectory });
    await exec('git commit -m "initial commit"', { cwd: testDirectory });
    await exec("git branch -m main", { cwd: testDirectory });

    await exec("git remote add origin https://github.com/test/repo.git", { cwd: testDirectory });
    await exec("git symbolic-ref refs/remotes/origin/HEAD refs/remotes/origin/main", {
      cwd: testDirectory,
    });
    await exec("git update-ref refs/remotes/origin/main HEAD", { cwd: testDirectory });

    await exec("git checkout -b feature-branch", { cwd: testDirectory });
    await exec("git branch -D main", { cwd: testDirectory });

    await fs.promises.writeFile(path.join(testDirectory, "feature.txt"), "feature content");
    await exec("git add .", { cwd: testDirectory });
    await exec('git commit -m "add feature"', { cwd: testDirectory });

    const diffInfo = await getDiffInfo(testDirectory);

    expect(diffInfo).not.toBeNull();
    expect(diffInfo?.changedFiles).toContain("feature.txt");
    expect(diffInfo?.isCurrentChanges).toBeFalsy();
    expect(diffInfo?.currentBranch).toBe("feature-branch");
    expect(diffInfo?.baseBranch).toBe("origin/main");
  });

  it("detects committed changes on main when ahead of origin/main", async () => {
    await exec("git init", { cwd: testDirectory });
    await exec('git config user.email "test@example.com"', { cwd: testDirectory });
    await exec('git config user.name "Test User"', { cwd: testDirectory });

    await fs.promises.writeFile(path.join(testDirectory, "initial.txt"), "initial content");
    await exec("git add .", { cwd: testDirectory });
    await exec('git commit -m "initial commit"', { cwd: testDirectory });
    await exec("git branch -m main", { cwd: testDirectory });

    await exec("git remote add origin https://github.com/test/repo.git", { cwd: testDirectory });
    await exec("git symbolic-ref refs/remotes/origin/HEAD refs/remotes/origin/main", {
      cwd: testDirectory,
    });
    await exec("git update-ref refs/remotes/origin/main HEAD", { cwd: testDirectory });

    await fs.promises.writeFile(path.join(testDirectory, "local-commit.txt"), "local change");
    await exec("git add .", { cwd: testDirectory });
    await exec('git commit -m "local commit ahead of origin"', { cwd: testDirectory });

    const diffInfo = await getDiffInfo(testDirectory);

    expect(diffInfo).not.toBeNull();
    expect(diffInfo?.changedFiles).toContain("local-commit.txt");
    expect(diffInfo?.isCurrentChanges).toBeFalsy();
    expect(diffInfo?.currentBranch).toBe("main");
    expect(diffInfo?.baseBranch).toBe("origin/main");
  });
});
