import * as child_process from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as Effect from "effect/Effect";
import { afterAll, describe, expect, it } from "vite-plus/test";
import { Git } from "@react-doctor/core";

const runNode = <Value>(program: Effect.Effect<Value, unknown, Git>): Promise<Value> =>
  Effect.runPromise(program.pipe(Effect.provide(Git.layerNode)));

const setupLinkedWorktreeRepo = (): { mainRepoPath: string; linkedWorktreePath: string } => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rd-1501-"));
  const mainRepoPath = path.join(tempRoot, "main-repo");
  const linkedWorktreePath = path.join(tempRoot, "linked-worktree");

  child_process.execSync("git init", { cwd: tempRoot, stdio: "ignore" });
  fs.renameSync(path.join(tempRoot, ".git"), path.join(tempRoot, "main-repo"));

  fs.mkdirSync(path.join(mainRepoPath, "webapp"), { recursive: true });
  fs.writeFileSync(path.join(mainRepoPath, "webapp", "index.html"), "<html></html>");
  fs.writeFileSync(path.join(mainRepoPath, "webapp", "app.js"), "console.log('app');");

  child_process.execSync("git config user.email 'test@example.com'", {
    cwd: mainRepoPath,
    env: { ...process.env, GIT_DIR: mainRepoPath },
    stdio: "ignore",
  });
  child_process.execSync("git config user.name 'Test User'", {
    cwd: mainRepoPath,
    env: { ...process.env, GIT_DIR: mainRepoPath },
    stdio: "ignore",
  });
  child_process.execSync("git add .", {
    cwd: mainRepoPath,
    env: { ...process.env, GIT_DIR: mainRepoPath },
    stdio: "ignore",
  });
  child_process.execSync("git commit -m 'initial'", {
    cwd: mainRepoPath,
    env: { ...process.env, GIT_DIR: mainRepoPath },
    stdio: "ignore",
  });

  child_process.execSync(`git worktree add ${linkedWorktreePath} -b feature`, {
    cwd: mainRepoPath,
    env: { ...process.env, GIT_DIR: mainRepoPath },
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

    const originalGitDir = process.env.GIT_DIR;
    process.env.GIT_DIR = testRepo.mainRepoPath;

    try {
      const result = await runNode(
        Effect.gen(function* () {
          const git = yield* Git;
          return yield* git.diffSelection({
            directory: webappPath,
            explicitBaseBranch: "HEAD",
          });
        }),
      );

      expect(result).not.toBeNull();
      if (result !== null) {
        expect(result.changedFiles).toEqual(["app.js"]);
      }
    } finally {
      if (originalGitDir === undefined) {
        delete process.env.GIT_DIR;
      } else {
        process.env.GIT_DIR = originalGitDir;
      }
    }
  });

  it("does not return repository-root paths when scanning a subdirectory with GIT_DIR set", async () => {
    const webappPath = path.join(testRepo.linkedWorktreePath, "webapp");

    const originalGitDir = process.env.GIT_DIR;
    process.env.GIT_DIR = testRepo.mainRepoPath;

    try {
      const result = await runNode(
        Effect.gen(function* () {
          const git = yield* Git;
          return yield* git.diffSelection({
            directory: webappPath,
            explicitBaseBranch: "HEAD",
          });
        }),
      );

      if (result !== null) {
        for (const filePath of result.changedFiles) {
          expect(filePath).not.toContain("webapp/");
          expect(path.isAbsolute(filePath)).toBe(false);
        }
      }
    } finally {
      if (originalGitDir === undefined) {
        delete process.env.GIT_DIR;
      } else {
        process.env.GIT_DIR = originalGitDir;
      }
    }
  });

  it("preserves GIT_INDEX_FILE when clearing GIT_DIR", async () => {
    const webappPath = path.join(testRepo.linkedWorktreePath, "webapp");
    const originalGitDir = process.env.GIT_DIR;
    const originalGitIndexFile = process.env.GIT_INDEX_FILE;
    const customIndexPath = path.join(testRepo.linkedWorktreePath, ".git", "custom-index");

    process.env.GIT_DIR = testRepo.mainRepoPath;
    process.env.GIT_INDEX_FILE = customIndexPath;

    try {
      const result = await runNode(
        Effect.gen(function* () {
          const git = yield* Git;
          return yield* git.currentBranch(webappPath);
        }),
      );

      expect(result).toBe("feature");
    } finally {
      if (originalGitDir === undefined) {
        delete process.env.GIT_DIR;
      } else {
        process.env.GIT_DIR = originalGitDir;
      }
      if (originalGitIndexFile === undefined) {
        delete process.env.GIT_INDEX_FILE;
      } else {
        process.env.GIT_INDEX_FILE = originalGitIndexFile;
      }
    }
  });
});
