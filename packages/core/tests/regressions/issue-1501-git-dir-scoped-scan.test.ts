import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as Effect from "effect/Effect";
import { afterAll, describe, expect, it } from "vite-plus/test";
import { Git } from "@react-doctor/core";

const runNode = <Value>(program: Effect.Effect<Value, unknown, Git>): Promise<Value> =>
  Effect.runPromise(program.pipe(Effect.provide(Git.layerNode)));

interface GitEnvironmentInput<Value> {
  readonly gitDirectory: string;
  readonly gitIndexFile?: string;
  readonly run: () => Promise<Value>;
}

const withGitEnvironment = async <Value>(input: GitEnvironmentInput<Value>): Promise<Value> => {
  const originalGitDirectory = process.env.GIT_DIR;
  const originalGitIndexFile = process.env.GIT_INDEX_FILE;
  process.env.GIT_DIR = input.gitDirectory;
  if (input.gitIndexFile !== undefined) process.env.GIT_INDEX_FILE = input.gitIndexFile;
  try {
    return await input.run();
  } finally {
    if (originalGitDirectory === undefined) delete process.env.GIT_DIR;
    else process.env.GIT_DIR = originalGitDirectory;
    if (originalGitIndexFile === undefined) delete process.env.GIT_INDEX_FILE;
    else process.env.GIT_INDEX_FILE = originalGitIndexFile;
  }
};

const setupLinkedWorktreeRepo = (): { mainRepoPath: string; linkedWorktreePath: string } => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rd-1501-"));
  const mainRepoPath = path.join(tempRoot, "main-repo");
  const linkedWorktreePath = path.join(tempRoot, "linked-worktree");
  const gitEnvironment = { ...process.env, GIT_DIR: mainRepoPath };

  execFileSync("git", ["init"], { cwd: tempRoot, stdio: "ignore" });
  fs.renameSync(path.join(tempRoot, ".git"), path.join(tempRoot, "main-repo"));

  fs.mkdirSync(path.join(mainRepoPath, "webapp"), { recursive: true });
  fs.writeFileSync(path.join(mainRepoPath, "webapp", "index.html"), "<html></html>");
  fs.writeFileSync(path.join(mainRepoPath, "webapp", "app.js"), "console.log('app');");

  execFileSync("git", ["config", "user.email", "test@example.com"], {
    cwd: mainRepoPath,
    env: gitEnvironment,
    stdio: "ignore",
  });
  execFileSync("git", ["config", "user.name", "Test User"], {
    cwd: mainRepoPath,
    env: gitEnvironment,
    stdio: "ignore",
  });
  execFileSync("git", ["add", "."], {
    cwd: mainRepoPath,
    env: gitEnvironment,
    stdio: "ignore",
  });
  execFileSync("git", ["commit", "-m", "initial"], {
    cwd: mainRepoPath,
    env: gitEnvironment,
    stdio: "ignore",
  });

  execFileSync("git", ["worktree", "add", linkedWorktreePath, "-b", "feature"], {
    cwd: mainRepoPath,
    env: gitEnvironment,
    stdio: "ignore",
  });

  fs.writeFileSync(path.join(linkedWorktreePath, "webapp", "app.js"), "console.log('modified');");

  return { mainRepoPath, linkedWorktreePath };
};

const testRepo = setupLinkedWorktreeRepo();

afterAll(() => {
  fs.rmSync(path.dirname(testRepo.mainRepoPath), { recursive: true, force: true });
});

describe("issue #1501: scoped scans fail inside Git hooks when GIT_DIR is set", () => {
  it("returns paths relative to the scoped directory when GIT_DIR is set", async () => {
    const webappPath = path.join(testRepo.linkedWorktreePath, "webapp");
    const result = await withGitEnvironment({
      gitDirectory: testRepo.mainRepoPath,
      run: () =>
        runNode(
          Effect.gen(function* () {
            const git = yield* Git;
            return yield* git.diffSelection({
              directory: webappPath,
              explicitBaseBranch: "HEAD",
            });
          }),
        ),
    });

    expect(result).not.toBeNull();
    if (result !== null) {
      expect(result.changedFiles).toEqual(["app.js"]);
    }
  });

  it("does not return repository-root paths when scanning a subdirectory with GIT_DIR set", async () => {
    const webappPath = path.join(testRepo.linkedWorktreePath, "webapp");
    const result = await withGitEnvironment({
      gitDirectory: testRepo.mainRepoPath,
      run: () =>
        runNode(
          Effect.gen(function* () {
            const git = yield* Git;
            return yield* git.diffSelection({
              directory: webappPath,
              explicitBaseBranch: "HEAD",
            });
          }),
        ),
    });

    if (result !== null) {
      for (const filePath of result.changedFiles) {
        expect(filePath).not.toContain("webapp/");
        expect(path.isAbsolute(filePath)).toBe(false);
      }
    }
  });

  it("preserves GIT_INDEX_FILE when clearing GIT_DIR", async () => {
    const webappPath = path.join(testRepo.linkedWorktreePath, "webapp");
    const customIndexPath = path.join(path.dirname(testRepo.mainRepoPath), "custom-index");
    const customIndexEnvironment = {
      ...process.env,
      GIT_DIR: undefined,
      GIT_INDEX_FILE: customIndexPath,
    };
    execFileSync("git", ["read-tree", "HEAD"], {
      cwd: testRepo.linkedWorktreePath,
      env: customIndexEnvironment,
      stdio: "ignore",
    });
    execFileSync("git", ["add", "webapp/app.js"], {
      cwd: testRepo.linkedWorktreePath,
      env: customIndexEnvironment,
      stdio: "ignore",
    });

    const stagedFiles = await withGitEnvironment({
      gitDirectory: testRepo.mainRepoPath,
      gitIndexFile: customIndexPath,
      run: () =>
        runNode(
          Effect.gen(function* () {
            const git = yield* Git;
            return yield* git.stagedFilePaths(webappPath);
          }),
        ),
    });

    expect(stagedFiles).toEqual(["app.js"]);
  });
});
