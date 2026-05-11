import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { filterSourceFiles, getDiffInfo } from "../src/utils/get-diff-files.js";

const GIT_COMMIT_OPTIONS = ["-q", "-m", "commit"];

const runGit = (directory: string, args: string[]): void => {
  const result = spawnSync("git", args, { cwd: directory, encoding: "utf-8" });
  if (result.status !== 0) {
    throw new Error(result.stderr.toString());
  }
};

const writeFile = (directory: string, relativePath: string, contents: string): void => {
  const filePath = path.join(directory, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents);
};

describe("getDiffInfo", () => {
  let directory: string;

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "react-doctor-diff-"));
    runGit(directory, ["init", "-q", "-b", "main"]);
    runGit(directory, ["config", "user.email", "test@example.com"]);
    runGit(directory, ["config", "user.name", "test"]);
    writeFile(directory, "src/app.tsx", "export const App = () => null;\n");
    runGit(directory, ["add", "."]);
    runGit(directory, ["commit", ...GIT_COMMIT_OPTIONS]);
  });

  afterEach(() => {
    fs.rmSync(directory, { recursive: true, force: true });
  });

  it("returns uncommitted files when current branch equals base branch", () => {
    writeFile(directory, "src/app.tsx", "export const App = () => <main />;\n");

    expect(getDiffInfo(directory, "main")).toEqual({
      currentBranch: "main",
      baseBranch: "main",
      changedFiles: ["src/app.tsx"],
      isCurrentChanges: true,
    });
  });

  it("returns null when current branch has no uncommitted changes", () => {
    expect(getDiffInfo(directory, "main")).toBeNull();
  });

  it("returns changed files since merge base for a feature branch", () => {
    runGit(directory, ["checkout", "-q", "-b", "feature"]);
    writeFile(directory, "src/feature.ts", "export const feature = true;\n");
    runGit(directory, ["add", "."]);
    runGit(directory, ["commit", ...GIT_COMMIT_OPTIONS]);

    expect(getDiffInfo(directory, "main")).toEqual({
      currentBranch: "feature",
      baseBranch: "main",
      changedFiles: ["src/feature.ts"],
    });
  });

  it("detects default branch from local branch candidates", () => {
    runGit(directory, ["checkout", "-q", "-b", "feature"]);
    writeFile(directory, "src/feature.ts", "export const feature = true;\n");
    runGit(directory, ["add", "."]);
    runGit(directory, ["commit", ...GIT_COMMIT_OPTIONS]);

    expect(getDiffInfo(directory)).toEqual({
      currentBranch: "feature",
      baseBranch: "main",
      changedFiles: ["src/feature.ts"],
    });
  });

  it("throws for empty and missing explicit base branches", () => {
    expect(() => getDiffInfo(directory, " ")).toThrow("Diff base branch cannot be empty.");
    expect(() => getDiffInfo(directory, "missing")).toThrow('Diff base branch "missing"');
  });
});

describe("filterSourceFiles", () => {
  it("keeps supported source files only", () => {
    expect(filterSourceFiles(["src/app.tsx", "src/app.css", "src/util.ts"])).toEqual([
      "src/app.tsx",
      "src/util.ts",
    ]);
  });
});
