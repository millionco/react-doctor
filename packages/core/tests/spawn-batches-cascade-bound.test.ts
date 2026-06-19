/**
 * Covers the binary-split cascade bound in `spawnLintBatches`: a batch whose
 * every spawn fails with a splittable error must NOT recurse without limit.
 * The cumulative split-time budget and the recursion-depth cap each drop the
 * remaining files via `onPartialFailure` instead of re-waiting a full spawn
 * timeout at every level (the `Linter.run` 7.5h-tail fix).
 *
 * Mocks `node:child_process.spawn` with a fake child that always exits on a
 * kill signal → `OxlintBatchExceeded { kind: "killed" }`, which is splittable.
 * Isolated in its own file so the real-spawn suites keep the genuine binary.
 */

import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { ProjectInfo } from "@react-doctor/core";

interface SpawnMockState {
  callCount: number;
}

const spawnState = vi.hoisted((): SpawnMockState => ({ callCount: 0 }));

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  // Every spawn exits on a kill signal, which `spawnOxlint` maps to a
  // splittable `OxlintBatchExceeded { kind: "killed" }` — deterministic and
  // timer-free, so the cascade bound is exercised without real waits.
  const spawn = () => {
    spawnState.callCount += 1;
    const child = Object.assign(new EventEmitter(), {
      stdout: new EventEmitter(),
      stderr: new EventEmitter(),
      kill: () => {},
    });
    // Defer past the synchronous listener attachment in `spawnOxlint`.
    queueMicrotask(() => {
      child.emit("close", null, "SIGKILL");
    });
    return child;
  };
  return { ...actual, spawn };
});

import { spawnLintBatches } from "../src/runners/oxlint/spawn-batches.js";

const project: ProjectInfo = {
  rootDirectory: "/tmp/app",
  projectName: "app",
  reactVersion: "19.2.0",
  reactMajorVersion: 19,
  tailwindVersion: null,
  framework: "unknown",
  hasTypeScript: true,
  hasReactCompiler: false,
  hasTanStackQuery: false,
  nextjsVersion: null,
  nextjsMajorVersion: null,
  hasReactNativeWorkspace: false,
  expoVersion: null,
  shopifyFlashListVersion: null,
  shopifyFlashListMajorVersion: null,
  hasReanimated: false,
  isPreES2023Target: false,
  preactVersion: null,
  preactMajorVersion: null,
  sourceFileCount: 6,
};

const FILE_COUNT = 100;
const singleLargeBatch = (): string[][] => [
  Array.from({ length: FILE_COUNT }, (_unused, index) => `src/file-${index}.tsx`),
];

beforeEach(() => {
  spawnState.callCount = 0;
});

describe("spawnLintBatches binary-split cascade bound", () => {
  it("drops the whole batch after one spawn when the cumulative split budget is exhausted", async () => {
    const partialFailures: string[] = [];
    const diagnostics = await spawnLintBatches({
      baseArgs: ["--stub"],
      fileBatches: singleLargeBatch(),
      rootDirectory: process.cwd(),
      nodeBinaryPath: process.execPath,
      project,
      onPartialFailure: (reason) => partialFailures.push(reason),
      // Budget already elapsed → the first splittable failure drops the
      // batch instead of recursing into more full-timeout waits.
      splitTotalBudgetMs: 0,
    });

    expect(diagnostics).toEqual([]);
    // No binary-split recursion at all: one spawn, then the budget short-circuits.
    expect(spawnState.callCount).toBe(1);
    expect(partialFailures).toHaveLength(1);
    expect(partialFailures[0]).toContain(`${FILE_COUNT} file(s) failed to lint`);
    expect(partialFailures[0]).toContain("split budget exhausted");
  });

  it("bounds recursion at the depth cap rather than splitting down to single files", async () => {
    const partialFailures: string[] = [];
    const splitMaxDepth = 3;
    const diagnostics = await spawnLintBatches({
      baseArgs: ["--stub"],
      fileBatches: singleLargeBatch(),
      rootDirectory: process.cwd(),
      nodeBinaryPath: process.execPath,
      project,
      onPartialFailure: (reason) => partialFailures.push(reason),
      splitMaxDepth,
      // Large budget so the depth cap is the binding constraint.
      splitTotalBudgetMs: 600_000,
    });

    expect(diagnostics).toEqual([]);
    // A truncated binary tree spawns at most sum(2^d, d=0..depth) <= 2^(depth+1)
    // times. Without the cap a 100-file batch would split ~7 levels to single
    // files, and every re-timeout would wait a full spawn budget.
    expect(spawnState.callCount).toBeGreaterThan(1);
    expect(spawnState.callCount).toBeLessThanOrEqual(2 ** (splitMaxDepth + 1));
    expect(partialFailures).toHaveLength(1);
    expect(partialFailures[0]).toContain("split budget exhausted");
  });
});
