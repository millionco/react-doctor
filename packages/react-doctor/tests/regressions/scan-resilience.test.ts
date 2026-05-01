/**
 * Regression tests for scan-pipeline robustness — the issues here all
 * stemmed from a runtime crash, silent failure, or "all results lost on
 * one bad input" failure mode.
 *
 * Covered closed issues:
 *   #29  — `extractFailedPluginName` must never throw on undefined / null
 *          / non-Error inputs (the "cannot read 'match' of undefined" crash)
 *   #46 + #84 — oxlint must batch include-paths so a 1k+-file diff
 *               (Windows ENAMETOOLONG) or 70+ test file batch (oxlint
 *               SIGABRT @ 2.8GB RAM) doesn't blow up
 *   #53  — source file count must fall back to filesystem walk when not
 *          inside a git repo
 *   #89  — `--offline` calculates the score locally (no network round trip)
 *   #115 — `--staged` snapshots git INDEX content (not working tree) so
 *          partially-staged hunks behave correctly
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vite-plus/test";

import { OXLINT_MAX_FILES_PER_BATCH, SPAWN_ARGS_MAX_LENGTH_CHARS } from "../../src/constants.js";
import { calculateScoreLocally } from "../../src/core/calculate-score-locally.js";
import { batchIncludePaths } from "../../src/utils/batch-include-paths.js";
import { discoverProject } from "../../src/utils/discover-project.js";
import { extractFailedPluginName } from "../../src/utils/extract-failed-plugin-name.js";
import { getStagedSourceFiles, materializeStagedFiles } from "../../src/utils/get-staged-files.js";
import { buildDiagnostic, initGitRepo, writeFile, writeJson } from "./_helpers.js";

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rd-scan-resilience-"));

afterAll(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

describe("issue #29: extract-failed-plugin-name handles bad inputs safely", () => {
  it("never throws on undefined / null / non-Error inputs", () => {
    expect(extractFailedPluginName(undefined)).toBeNull();
    expect(extractFailedPluginName(null)).toBeNull();
    expect(extractFailedPluginName({})).toBeNull();
    expect(extractFailedPluginName({ message: undefined })).toBeNull();
    expect(extractFailedPluginName(42)).toBeNull();
  });
});

describe("issue #46 + #84: oxlint include-path batching", () => {
  it("SPAWN_ARGS_MAX_LENGTH_CHARS leaves headroom under Windows CreateProcessW (32_767)", () => {
    expect(SPAWN_ARGS_MAX_LENGTH_CHARS).toBeLessThan(32_767);
    expect(SPAWN_ARGS_MAX_LENGTH_CHARS).toBeGreaterThan(8_000);
  });

  it("OXLINT_MAX_FILES_PER_BATCH is small enough to avoid SIGABRT on large file sets", () => {
    // oxlint 1.50.0 was crashing at ~70 files with 2.8GB RAM. Stay safely below.
    expect(OXLINT_MAX_FILES_PER_BATCH).toBeGreaterThanOrEqual(50);
    expect(OXLINT_MAX_FILES_PER_BATCH).toBeLessThanOrEqual(1_000);
  });

  it("batchIncludePaths splits when it would exceed OXLINT_MAX_FILES_PER_BATCH", () => {
    const baseArgs = ["oxlint", "-c", "/tmp/oxlintrc.json", "--format", "json"];
    const includePaths = Array.from(
      { length: OXLINT_MAX_FILES_PER_BATCH * 2 + 5 },
      (_, index) => `src/file-${index}.tsx`,
    );
    const batches = batchIncludePaths(baseArgs, includePaths);

    expect(batches.length).toBe(3);
    expect(batches[0]).toHaveLength(OXLINT_MAX_FILES_PER_BATCH);
    expect(batches[1]).toHaveLength(OXLINT_MAX_FILES_PER_BATCH);
    expect(batches[2]).toHaveLength(5);
    expect(batches.flat()).toEqual(includePaths);
  });

  it("batchIncludePaths splits when paths would exceed SPAWN_ARGS_MAX_LENGTH_CHARS (Windows ENAMETOOLONG)", () => {
    const baseArgs = ["oxlint", "-c", "/tmp/oxlintrc.json", "--format", "json"];
    // Each path is 200 chars; 200 paths = ~40k chars, well past Windows
    // CreateProcessW's 32_767 limit. Must split into at least 2 batches.
    const longSegment = "a".repeat(180);
    const includePaths = Array.from(
      { length: 200 },
      (_, index) => `src/${longSegment}-${index}.tsx`,
    );

    const batches = batchIncludePaths(baseArgs, includePaths);

    expect(batches.length).toBeGreaterThan(1);
    for (const batch of batches) {
      const totalChars = batch.reduce(
        (total, current) => total + current.length + 1,
        baseArgs.reduce((total, current) => total + current.length + 1, 0),
      );
      expect(totalChars).toBeLessThanOrEqual(SPAWN_ARGS_MAX_LENGTH_CHARS);
    }
    expect(batches.flat()).toEqual(includePaths);
  });

  it("batchIncludePaths returns a single batch for small inputs and [] for empty", () => {
    expect(batchIncludePaths(["oxlint"], [])).toEqual([]);
    expect(batchIncludePaths(["oxlint"], ["src/a.tsx", "src/b.tsx"])).toEqual([
      ["src/a.tsx", "src/b.tsx"],
    ]);
  });
});

describe("issue #53: source file count fallback for non-git directories", () => {
  it("returns a non-zero count for a non-git project containing .tsx files", () => {
    const projectDir = path.join(tempRoot, "issue-53-non-git");
    fs.mkdirSync(path.join(projectDir, "src", "nested"), { recursive: true });
    writeJson(path.join(projectDir, "package.json"), {
      name: "non-git",
      dependencies: { react: "^19.0.0" },
    });
    writeFile(path.join(projectDir, "src", "App.tsx"), "export const App = () => null;\n");
    writeFile(
      path.join(projectDir, "src", "nested", "Component.tsx"),
      "export const Component = () => null;\n",
    );
    writeFile(path.join(projectDir, "src", "utils.ts"), "export const x = 1;\n");
    expect(fs.existsSync(path.join(projectDir, ".git"))).toBe(false);

    const projectInfo = discoverProject(projectDir);
    expect(projectInfo.sourceFileCount).toBeGreaterThanOrEqual(3);
  });
});

describe("issue #89: --offline produces a score calculated locally", () => {
  it("calculateScoreLocally returns a non-null score with a valid label", () => {
    const score = calculateScoreLocally([
      buildDiagnostic({ severity: "error", rule: "rule-a" }),
      buildDiagnostic({ severity: "warning", rule: "rule-b" }),
      buildDiagnostic({ severity: "warning", rule: "rule-b" }), // duplicate rule, dedup'd
    ]);
    expect(score).not.toBeNull();
    expect(score.score).toBeGreaterThan(0);
    expect(score.score).toBeLessThanOrEqual(100);
    expect(["Great", "Needs work", "Critical"]).toContain(score.label);
  });

  it("returns 100/Great when there are no diagnostics", () => {
    expect(calculateScoreLocally([])).toEqual({ score: 100, label: "Great" });
  });

  it("does not require any network access", async () => {
    // Sanity: no `fetch` involvement in the local scoring path.
    const calculateSource = fs.readFileSync(
      path.resolve(import.meta.dirname, "../../src/core/calculate-score-locally.ts"),
      "utf8",
    );
    expect(calculateSource).not.toContain("fetch(");
    expect(calculateSource).not.toContain("api/score");
  });
});

describe("issue #115: --staged uses git INDEX content, not working tree", () => {
  it("getStagedSourceFiles returns staged JSX/TSX paths from the index", () => {
    const repoDir = path.join(tempRoot, "issue-115-paths");
    fs.mkdirSync(path.join(repoDir, "src"), { recursive: true });
    writeJson(path.join(repoDir, "package.json"), { name: "staged-paths" });
    writeFile(path.join(repoDir, "src", "App.tsx"), "export const App = () => null;\n");
    writeFile(path.join(repoDir, "src", "ignored.txt"), "not source");

    initGitRepo(repoDir);
    spawnSync("git", ["add", "src/App.tsx", "src/ignored.txt"], { cwd: repoDir });

    const stagedFiles = getStagedSourceFiles(repoDir);
    expect(stagedFiles).toContain("src/App.tsx");
    expect(stagedFiles).not.toContain("src/ignored.txt");
  });

  it("materializeStagedFiles snapshots INDEX content even when working tree differs", () => {
    const repoDir = path.join(tempRoot, "issue-115-snapshot");
    fs.mkdirSync(path.join(repoDir, "src"), { recursive: true });
    writeJson(path.join(repoDir, "package.json"), { name: "staged-snapshot" });
    writeFile(path.join(repoDir, "src", "App.tsx"), "export const ORIGINAL = 1;\n");

    initGitRepo(repoDir);
    spawnSync("git", ["add", "src/App.tsx"], { cwd: repoDir });
    spawnSync("git", ["commit", "-q", "-m", "init"], { cwd: repoDir });

    // Stage new content, then mutate the working tree on top of the staged version.
    writeFile(path.join(repoDir, "src", "App.tsx"), "export const STAGED = 2;\n");
    spawnSync("git", ["add", "src/App.tsx"], { cwd: repoDir });
    writeFile(path.join(repoDir, "src", "App.tsx"), "export const WORKING_TREE = 3;\n");

    const stagedFiles = getStagedSourceFiles(repoDir);
    expect(stagedFiles).toEqual(["src/App.tsx"]);

    const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "rd-staged-snapshot-"));
    const snapshot = materializeStagedFiles(repoDir, stagedFiles, tempDirectory);
    try {
      const snapshotted = fs.readFileSync(
        path.join(snapshot.tempDirectory, "src", "App.tsx"),
        "utf8",
      );
      expect(snapshotted).toContain("STAGED");
      expect(snapshotted).not.toContain("WORKING_TREE");
    } finally {
      snapshot.cleanup();
    }
  });

  it("getStagedSourceFiles returns [] for a repo with nothing staged", () => {
    const repoDir = path.join(tempRoot, "issue-115-empty");
    fs.mkdirSync(repoDir, { recursive: true });
    writeJson(path.join(repoDir, "package.json"), { name: "empty-staged" });
    initGitRepo(repoDir);
    expect(getStagedSourceFiles(repoDir)).toEqual([]);
  });
});
