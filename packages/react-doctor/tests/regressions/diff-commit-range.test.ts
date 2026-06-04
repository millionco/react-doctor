/**
 * Regression for REACT-DOCTOR-9: `react-doctor --diff 7694215..c4de712`
 * (a git commit RANGE rather than a single base ref) used to be rejected
 * by the anti-injection guard and surfaced as a Sentry-reported crash.
 *
 * `--diff` now accepts git's own range syntax — two-dot `A..B` (diff A
 * directly against B) and three-dot `A...B` (diff from the merge-base of
 * A and B to B) — while still validating each endpoint, so a range can't
 * smuggle a `--upload-pack=…`-style option past the guard.
 */

import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import { afterAll, describe, expect, it } from "vite-plus/test";

import { getDiffInfo } from "@react-doctor/core";
import { commitAll, initGitRepo, writeFile } from "./_helpers.js";

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rd-diff-range-"));

afterAll(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

const sortedChangedFiles = (files: readonly string[] | undefined): string[] =>
  [...(files ?? [])].sort();

/** Fresh repo with a single committed `src/app.tsx`; returns the dir and that commit's SHA. */
const initRepoWithApp = (caseId: string): { repoDir: string; initSha: string } => {
  const repoDir = path.join(tempRoot, caseId);
  fs.mkdirSync(repoDir, { recursive: true });
  writeFile(path.join(repoDir, "src", "app.tsx"), "export const App = () => null;\n");
  initGitRepo(repoDir);
  return { repoDir, initSha: commitAll(repoDir, "init") };
};

describe("REACT-DOCTOR-9: --diff accepts commit ranges", () => {
  it("returns files changed across a two-dot `A..B` range on linear history", async () => {
    const { repoDir, initSha: shaA } = initRepoWithApp("linear-two-dot");

    writeFile(path.join(repoDir, "src", "feature.tsx"), "export const Feature = () => null;\n");
    const shaB = commitAll(repoDir, "add feature");

    writeFile(path.join(repoDir, "src", "extra.tsx"), "export const Extra = () => null;\n");
    const shaC = commitAll(repoDir, "add extra");

    const oneCommit = await getDiffInfo(repoDir, `${shaA}..${shaB}`);
    expect(oneCommit?.baseBranch).toBe(shaA);
    // currentBranch reflects the working-tree branch (here `main`), not the
    // range's head endpoint — same contract as single-base `--diff`.
    expect(oneCommit?.currentBranch).toBe("main");
    expect(oneCommit?.isCurrentChanges).toBeUndefined();
    expect(sortedChangedFiles(oneCommit?.changedFiles)).toEqual(["src/feature.tsx"]);

    const twoCommits = await getDiffInfo(repoDir, `${shaA}..${shaC}`);
    expect(sortedChangedFiles(twoCommits?.changedFiles)).toEqual([
      "src/extra.tsx",
      "src/feature.tsx",
    ]);
  });

  it("distinguishes two-dot from three-dot on a divergent history (merge-base semantics)", async () => {
    const repoDir = path.join(tempRoot, "divergent");
    fs.mkdirSync(repoDir, { recursive: true });
    writeFile(path.join(repoDir, "src", "shared.tsx"), "export const v = 1;\n");
    writeFile(path.join(repoDir, "src", "app.tsx"), "export const App = () => null;\n");
    initGitRepo(repoDir);
    const shaBase = commitAll(repoDir, "init");

    // main advances: modify the shared file and add a main-only file.
    writeFile(path.join(repoDir, "src", "shared.tsx"), "export const v = 2;\n");
    writeFile(path.join(repoDir, "src", "main-only.tsx"), "export const MainOnly = () => null;\n");
    const shaMain = commitAll(repoDir, "main work");

    // feature branches from the base (leaving shared.tsx untouched).
    spawnSync("git", ["checkout", "-q", "-b", "feature", shaBase], { cwd: repoDir });
    writeFile(path.join(repoDir, "src", "feature.tsx"), "export const Feature = () => null;\n");
    const shaFeature = commitAll(repoDir, "feature work");

    // Two-dot diffs the two commits directly: shared.tsx differs between
    // them (v2 on main vs v1 on feature), so it is included.
    const twoDot = await getDiffInfo(repoDir, `${shaMain}..${shaFeature}`);
    expect(sortedChangedFiles(twoDot?.changedFiles)).toEqual(["src/feature.tsx", "src/shared.tsx"]);

    // Three-dot diffs from the merge-base (the init commit) to feature, so
    // shared.tsx — unchanged on the feature side — is excluded.
    const threeDot = await getDiffInfo(repoDir, `${shaMain}...${shaFeature}`);
    expect(sortedChangedFiles(threeDot?.changedFiles)).toEqual(["src/feature.tsx"]);
  });

  it("rejects a range whose endpoint does not exist (clean 'does not exist')", async () => {
    const { repoDir } = initRepoWithApp("missing-endpoint");
    await expect(getDiffInfo(repoDir, "main..origin/does-not-exist")).rejects.toThrow(
      /does not exist/,
    );
  });

  it("rejects a range whose endpoint looks like a git option", async () => {
    const { repoDir } = initRepoWithApp("option-injection");
    await expect(getDiffInfo(repoDir, "main..--upload-pack=evil")).rejects.toThrow(
      /invalid endpoint/,
    );
  });
});
