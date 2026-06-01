/**
 * Covers the parallel → serial fallback in `spawnLintBatches`: a parallel
 * run that fails with a parallelism-exclusive resource error (EAGAIN /
 * EMFILE / …) replays the whole pass with a single worker, while every
 * other failure propagates unchanged.
 *
 * The fallback only triggers on a real `spawn` "error" event carrying a
 * system code — which a stub binary can't produce — so this suite mocks
 * `node:child_process.spawn` with a fake child whose first invocation emits
 * a configurable failure and whose later invocations succeed (empty stdout
 * → `[]`). Isolated in its own file so the real-spawn suites elsewhere keep
 * using the genuine binary.
 */

import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { ProjectInfo } from "@react-doctor/core";

interface SpawnMockState {
  callCount: number;
  // Outcome for the FIRST spawn call only; every later call succeeds with
  // empty stdout. `null` → the first call also succeeds.
  firstError: { code?: string } | null;
}

const spawnState = vi.hoisted((): SpawnMockState => ({ callCount: 0, firstError: null }));

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  const spawn = () => {
    spawnState.callCount += 1;
    const isFirstCall = spawnState.callCount === 1;
    const child = Object.assign(new EventEmitter(), {
      stdout: new EventEmitter(),
      stderr: new EventEmitter(),
      kill: () => {},
    });
    // Defer past the synchronous listener attachment in `spawnOxlint`.
    queueMicrotask(() => {
      if (isFirstCall && spawnState.firstError) {
        const error: NodeJS.ErrnoException = new Error("spawn failed");
        if (spawnState.firstError.code) error.code = spawnState.firstError.code;
        child.emit("error", error);
        return;
      }
      // Empty stdout + clean exit → `parseOxlintOutput("")` → [].
      child.emit("close", 0, null);
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
  hasReactNativeWorkspace: false,
  hasReanimated: false,
  preactVersion: null,
  preactMajorVersion: null,
  sourceFileCount: 6,
};

const BATCH_COUNT = 6;

const runWithConcurrency = (concurrency: number) =>
  spawnLintBatches({
    baseArgs: ["--stub"],
    fileBatches: Array.from({ length: BATCH_COUNT }, (_unused, index) => [`src/file-${index}.tsx`]),
    rootDirectory: process.cwd(),
    nodeBinaryPath: process.execPath,
    project,
    concurrency,
  });

beforeEach(() => {
  spawnState.callCount = 0;
  spawnState.firstError = null;
});

describe("spawnLintBatches parallel → serial fallback", () => {
  it("replays the pass serially when a parallel run exhausts process resources", async () => {
    spawnState.firstError = { code: "EAGAIN" };

    await expect(runWithConcurrency(4)).resolves.toEqual([]);
    // The failed parallel pass plus the full serial replay means spawn was
    // invoked for more than one pass's worth of batches — proof the replay ran.
    expect(spawnState.callCount).toBeGreaterThan(BATCH_COUNT);
  });

  it("propagates a failure unrelated to parallelism instead of retrying", async () => {
    // A spawn error with no system code stands in for a config crash: it
    // would recur on a serial retry, so the pass must fail outright.
    spawnState.firstError = {};

    await expect(runWithConcurrency(4)).rejects.toThrow(/Failed to run oxlint/);
  });

  it("does not retry a run that was already serial (concurrency 1)", async () => {
    spawnState.firstError = { code: "EAGAIN" };

    await expect(runWithConcurrency(1)).rejects.toThrow(/Failed to run oxlint/);
    // One worker, one failing spawn, no replay.
    expect(spawnState.callCount).toBe(1);
  });
});
