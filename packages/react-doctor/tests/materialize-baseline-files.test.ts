import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { materializeBaselineFiles } from "../src/cli/utils/materialize-baseline-files.js";

const runGit = (directory: string, args: ReadonlyArray<string>): string =>
  execFileSync("git", args, { cwd: directory, encoding: "utf-8" }).trim();

const commitAll = (directory: string, message: string): string => {
  runGit(directory, ["add", "-A"]);
  runGit(directory, ["commit", "-m", message]);
  return runGit(directory, ["rev-parse", "HEAD"]);
};

describe("materializeBaselineFiles", () => {
  let directory: string;
  let tempDirectory: string;

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "react-doctor-baseline-repo-"));
    tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "react-doctor-baseline-tree-"));
    runGit(directory, ["init", "--quiet"]);
    runGit(directory, ["config", "user.email", "react-doctor@example.com"]);
    runGit(directory, ["config", "user.name", "React Doctor"]);
  });

  afterEach(() => {
    fs.rmSync(directory, { recursive: true, force: true });
    fs.rmSync(tempDirectory, { recursive: true, force: true });
  });

  it("materializes the old path for a pure rename", async () => {
    const oldPath = path.join(directory, "src/old-name.tsx");
    const newPath = path.join(directory, "src/new-name.tsx");
    fs.mkdirSync(path.dirname(oldPath), { recursive: true });
    fs.writeFileSync(oldPath, "export const value = 1;\n");
    const baseRef = commitAll(directory, "base");
    fs.renameSync(oldPath, newPath);
    runGit(directory, ["add", "-A"]);

    const snapshot = await materializeBaselineFiles({
      directory,
      ref: baseRef,
      files: ["src/new-name.tsx"],
      tempDirectory,
    });

    expect(snapshot?.isComplete).toBe(true);
    expect(snapshot?.baseFiles).toEqual(["src/old-name.tsx"]);
    expect(snapshot?.headFiles).toEqual(["src/new-name.tsx"]);
    expect(snapshot?.untrackedFiles).toEqual([]);
    expect(snapshot?.materializedFiles).toEqual(["src/old-name.tsx"]);
    expect(fs.readFileSync(path.join(tempDirectory, "src/old-name.tsx"), "utf-8")).toBe(
      "export const value = 1;\n",
    );
    snapshot?.cleanup();
  });

  it("does not treat an added head file as an incomplete base snapshot", async () => {
    runGit(directory, ["commit", "--allow-empty", "-m", "base"]);
    const baseRef = runGit(directory, ["rev-parse", "HEAD"]);
    const addedPath = path.join(directory, "src/added.tsx");
    fs.mkdirSync(path.dirname(addedPath), { recursive: true });
    fs.writeFileSync(addedPath, "export const value = 1;\n");
    runGit(directory, ["add", "-A"]);

    const snapshot = await materializeBaselineFiles({
      directory,
      ref: baseRef,
      files: ["src/added.tsx"],
      tempDirectory,
    });

    expect(snapshot?.isComplete).toBe(true);
    expect(snapshot?.baseFiles).toEqual([]);
    expect(snapshot?.headFiles).toEqual(["src/added.tsx"]);
    expect(snapshot?.untrackedFiles).toEqual([]);
    expect(snapshot?.materializedFiles).toEqual([]);
    expect(snapshot?.unmaterializedFiles).toEqual(["src/added.tsx"]);
    snapshot?.cleanup();
  });

  it("degrades when a required base source is an unsmudged Git LFS pointer", async () => {
    const filePath = "src/tracked.tsx";
    const absolutePath = path.join(directory, filePath);
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
    fs.writeFileSync(
      absolutePath,
      "version https://git-lfs.github.com/spec/v1\noid sha256:0123456789\nsize 10\n",
    );
    const baseRef = commitAll(directory, "base");
    fs.writeFileSync(absolutePath, "export const value = 1;\n");

    const snapshot = await materializeBaselineFiles({
      directory,
      ref: baseRef,
      files: [filePath],
      tempDirectory,
    });

    expect(snapshot?.isComplete).toBe(false);
    expect(snapshot?.unmaterializedFiles).toEqual([filePath]);
    snapshot?.cleanup();
  });

  it("materializes a deleted base source alongside the modified files", async () => {
    const deletedPath = path.join(directory, "src/components/footer.tsx");
    const modifiedPath = path.join(directory, "src/components/header.tsx");
    fs.mkdirSync(path.dirname(deletedPath), { recursive: true });
    fs.writeFileSync(deletedPath, "export const Footer = () => <footer />;\n");
    fs.writeFileSync(modifiedPath, "export const Header = () => <header />;\n");
    const baseRef = commitAll(directory, "base");
    fs.rmSync(deletedPath);
    fs.writeFileSync(modifiedPath, "export const Header = () => <header>hi</header>;\n");
    commitAll(directory, "delete footer");

    const snapshot = await materializeBaselineFiles({
      directory,
      ref: baseRef,
      files: ["src/components/header.tsx"],
      tempDirectory,
    });

    expect(snapshot?.isComplete).toBe(true);
    expect(snapshot?.baseFiles).toEqual(["src/components/footer.tsx", "src/components/header.tsx"]);
    expect(snapshot?.headFiles).toEqual(["src/components/header.tsx"]);
    expect(snapshot?.materializedFiles).toEqual([
      "src/components/header.tsx",
      "src/components/footer.tsx",
    ]);
    expect(fs.readFileSync(path.join(tempDirectory, "src/components/footer.tsx"), "utf-8")).toBe(
      "export const Footer = () => <footer />;\n",
    );
    snapshot?.cleanup();
  });

  it("stays complete when an unreadable base source no longer exists at head", async () => {
    const deletedPath = "src/pointer.tsx";
    const modifiedPath = "src/tracked.tsx";
    fs.mkdirSync(path.join(directory, "src"), { recursive: true });
    fs.writeFileSync(
      path.join(directory, deletedPath),
      "version https://git-lfs.github.com/spec/v1\noid sha256:0123456789\nsize 10\n",
    );
    fs.writeFileSync(path.join(directory, modifiedPath), "export const value = 1;\n");
    const baseRef = commitAll(directory, "base");
    fs.rmSync(path.join(directory, deletedPath));
    fs.writeFileSync(path.join(directory, modifiedPath), "export const value = 2;\n");

    const snapshot = await materializeBaselineFiles({
      directory,
      ref: baseRef,
      files: [modifiedPath],
      tempDirectory,
    });

    expect(snapshot?.isComplete).toBe(true);
    expect(snapshot?.baseFiles).toEqual([deletedPath, modifiedPath]);
    expect(snapshot?.headFiles).toEqual([modifiedPath]);
    expect(snapshot?.unmaterializedFiles).toEqual([deletedPath]);
    snapshot?.cleanup();
  });
});
