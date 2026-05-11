import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { getStagedSourceFiles, materializeStagedFiles } from "../src/utils/get-staged-files.js";

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

describe("get-staged-files", () => {
  let directory: string;

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "react-doctor-staged-"));
    runGit(directory, ["init", "-q", "-b", "main"]);
    runGit(directory, ["config", "user.email", "test@example.com"]);
    runGit(directory, ["config", "user.name", "test"]);
    writeFile(directory, "package.json", '{"name":"fixture"}\n');
    writeFile(directory, "src/app.tsx", "export const App = () => null;\n");
    runGit(directory, ["add", "."]);
    runGit(directory, ["commit", ...GIT_COMMIT_OPTIONS]);
  });

  afterEach(() => {
    fs.rmSync(directory, { recursive: true, force: true });
  });

  it("returns staged source files and ignores non-source files", () => {
    writeFile(directory, "src/app.tsx", "export const App = () => <main />;\n");
    writeFile(directory, "README.md", "# fixture\n");
    runGit(directory, ["add", "."]);

    expect(getStagedSourceFiles(directory)).toEqual(["src/app.tsx"]);
  });

  it("returns an empty list outside a git repository", () => {
    const nonGitDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "react-doctor-not-git-"));

    try {
      expect(getStagedSourceFiles(nonGitDirectory)).toEqual([]);
    } finally {
      fs.rmSync(nonGitDirectory, { recursive: true, force: true });
    }
  });

  it("materializes staged files and copies project config files", () => {
    const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "react-doctor-staged-copy-"));
    writeFile(directory, "src/app.tsx", "export const App = () => <main />;\n");
    runGit(directory, ["add", "src/app.tsx"]);

    const snapshot = materializeStagedFiles(directory, ["src/app.tsx"], tempDirectory);

    expect(snapshot.stagedFiles).toEqual(["src/app.tsx"]);
    expect(fs.readFileSync(path.join(tempDirectory, "src/app.tsx"), "utf-8")).toBe(
      "export const App = () => <main />;\n",
    );
    expect(fs.existsSync(path.join(tempDirectory, "package.json"))).toBe(true);

    snapshot.cleanup();
    expect(fs.existsSync(tempDirectory)).toBe(false);
  });

  it("skips staged paths when git cannot read their staged content", () => {
    const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "react-doctor-staged-copy-"));
    const snapshot = materializeStagedFiles(directory, ["src/missing.tsx"], tempDirectory);

    expect(snapshot.stagedFiles).toEqual([]);

    snapshot.cleanup();
  });
});
