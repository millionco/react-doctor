import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { findStagedSnapshotDivergences } from "../src/cli/utils/find-staged-snapshot-divergences.js";
import { parseStagedSnapshotDivergences } from "../src/cli/utils/parse-staged-snapshot-divergences.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const temporaryDirectory of temporaryDirectories.splice(0)) {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

const createRepository = (): string => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "rd-staged-snapshot-"));
  temporaryDirectories.push(directory);
  fs.mkdirSync(path.join(directory, "src"), { recursive: true });
  fs.writeFileSync(path.join(directory, "package.json"), '{"dependencies":{"react":"19"}}\n');
  fs.writeFileSync(path.join(directory, "doctor.config.json"), '{"rules":{}}\n');
  fs.writeFileSync(path.join(directory, "src/app.tsx"), "export const App = () => null;\n");
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: directory });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: directory });
  execFileSync("git", ["config", "user.name", "test"], { cwd: directory });
  execFileSync("git", ["config", "commit.gpgsign", "false"], { cwd: directory });
  execFileSync("git", ["add", "."], { cwd: directory });
  execFileSync("git", ["commit", "-q", "-m", "init"], { cwd: directory });
  return directory;
};

describe("findStagedSnapshotDivergences", () => {
  it("keeps staged source isolated from later worktree source edits", () => {
    const directory = createRepository();
    fs.writeFileSync(path.join(directory, "src/app.tsx"), "export const App = () => <div />;\n");
    execFileSync("git", ["add", "src/app.tsx"], { cwd: directory });
    fs.writeFileSync(path.join(directory, "src/app.tsx"), "export const App = () => <main />;\n");

    expect(findStagedSnapshotDivergences(directory)).toEqual([]);
  });

  it("accepts configuration whose staged and worktree contents match", () => {
    const directory = createRepository();
    fs.writeFileSync(path.join(directory, "doctor.config.json"), '{"warnings":true}\n');
    execFileSync("git", ["add", "doctor.config.json"], { cwd: directory });

    expect(findStagedSnapshotDivergences(directory)).toEqual([]);
  });

  it("reports an unstaged modification to tracked configuration", () => {
    const directory = createRepository();
    fs.writeFileSync(path.join(directory, "doctor.config.json"), '{"warnings":true}\n');

    expect(findStagedSnapshotDivergences(directory)).toEqual(["doctor.config.json"]);
  });

  it("reports tracked nested configuration that differs from the index", () => {
    const directory = createRepository();
    fs.mkdirSync(path.join(directory, "apps/web"), { recursive: true });
    fs.writeFileSync(path.join(directory, "apps/web/doctor.config.json"), '{"warnings":true}\n');
    execFileSync("git", ["add", "apps/web/doctor.config.json"], { cwd: directory });
    fs.writeFileSync(path.join(directory, "apps/web/doctor.config.json"), '{"warnings":false}\n');

    expect(findStagedSnapshotDivergences(directory)).toEqual(["apps/web/doctor.config.json"]);
  });

  it("reports governing configuration above the requested directory", () => {
    const directory = createRepository();
    fs.writeFileSync(path.join(directory, "doctor.config.json"), '{"warnings":true}\n');

    expect(findStagedSnapshotDivergences(path.join(directory, "src"))).toEqual([
      "doctor.config.json",
    ]);
  });

  it("reports ordinary and ignored untracked configuration", () => {
    const directory = createRepository();
    fs.writeFileSync(path.join(directory, ".gitignore"), "next.config.mjs\n");
    execFileSync("git", ["add", ".gitignore"], { cwd: directory });
    execFileSync("git", ["commit", "-q", "-m", "ignore config"], { cwd: directory });
    fs.writeFileSync(path.join(directory, "eslint.config.mjs"), "export default [];\n");
    fs.writeFileSync(path.join(directory, "next.config.mjs"), "export default {};\n");

    expect(findStagedSnapshotDivergences(directory)).toEqual([
      "eslint.config.mjs",
      "next.config.mjs",
    ]);
  });

  it("returns null outside a Git worktree", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "rd-staged-snapshot-no-git-"));
    temporaryDirectories.push(directory);

    expect(findStagedSnapshotDivergences(directory)).toBeNull();
  });

  it("reports a governing source path in a worktree-side rename record", () => {
    expect(parseStagedSnapshotDivergences(" R archive.txt\0doctor.config.json\0")).toEqual([
      "doctor.config.json",
    ]);
  });

  it("reports a governing destination path in a worktree-side copy record", () => {
    expect(parseStagedSnapshotDivergences(" C doctor.config.json\0archive.txt\0")).toEqual([
      "doctor.config.json",
    ]);
  });

  it("accepts an index-only rename whose destination is configuration", () => {
    expect(parseStagedSnapshotDivergences("R  doctor.config.json\0archive.txt\0")).toEqual([]);
  });

  it("accepts an index-only rename with a directory-prefixed configuration source", () => {
    expect(parseStagedSnapshotDivergences("R  archive.txt\0a/b/doctor.config.json\0")).toEqual([]);
  });

  it("ignores unstaged lockfile and .gitignore edits that cannot shape a staged scan", () => {
    const directory = createRepository();
    fs.writeFileSync(path.join(directory, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
    fs.writeFileSync(path.join(directory, ".gitignore"), "dist\n");
    execFileSync("git", ["add", "pnpm-lock.yaml", ".gitignore"], { cwd: directory });
    execFileSync("git", ["commit", "-q", "-m", "add lockfile"], { cwd: directory });
    fs.writeFileSync(path.join(directory, "src/app.tsx"), "export const App = () => <div />;\n");
    execFileSync("git", ["add", "src/app.tsx"], { cwd: directory });
    fs.writeFileSync(path.join(directory, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\nextra: 1\n");
    fs.writeFileSync(path.join(directory, ".gitignore"), "dist\nbuild\n");

    expect(findStagedSnapshotDivergences(directory)).toEqual([]);
  });

  it("reports an unstaged modification to the legacy react-doctor configuration", () => {
    expect(parseStagedSnapshotDivergences(" M react-doctor.config.json\0")).toEqual([
      "react-doctor.config.json",
    ]);
  });
});
