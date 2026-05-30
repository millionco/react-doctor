/**
 * Regression test for issue #599 — `react-doctor --staged` hung after
 * printing results.
 *
 * `spawnLintBatches` starts a ref'd `setInterval` progress timer per
 * multi-file batch and used to clear it only after `await spawnLintBatch`
 * resolved. When a batch rejects with a non-splittable error (an adopted
 * lint config crashing oxlint), that line was skipped and the timer
 * leaked — and because the caller silently retries and the CLI exits via
 * event-loop drain rather than `process.exit()`, the process hung. The
 * fix clears the timer in a `finally`.
 */

import { describe, expect, it } from "vite-plus/test";
import type { ProjectInfo } from "@react-doctor/core";
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
  sourceFileCount: 2,
};

describe("issue #599: spawnLintBatches never leaks its progress interval", () => {
  it("clears the progress timer when a multi-file batch rejects", async () => {
    const realSetInterval = globalThis.setInterval;
    const realClearInterval = globalThis.clearInterval;
    const liveIntervalHandles = new Set<ReturnType<typeof setInterval>>();
    let createdCount = 0;

    // HACK: instrument the timer globals to track the handles the runner
    // creates and clears internally.
    globalThis.setInterval = (...args: Parameters<typeof setInterval>) => {
      const handle = realSetInterval(...args);
      liveIntervalHandles.add(handle);
      createdCount += 1;
      return handle;
    };
    globalThis.clearInterval = (handle?: ReturnType<typeof setInterval>) => {
      if (handle !== undefined) liveIntervalHandles.delete(handle);
      realClearInterval(handle);
    };

    try {
      // HACK: `node -e` stands in for the oxlint binary — it writes to
      // stderr and exits 0, so empty stdout surfaces as a non-splittable
      // `OxlintSpawnFailed`, exactly like an adopted lint config crashing
      // oxlint. The batch has >1 file, so the progress interval is created.
      await expect(
        spawnLintBatches({
          baseArgs: ["-e", "process.stderr.write('boom')"],
          fileBatches: [["src/a.tsx", "src/b.tsx"]],
          rootDirectory: process.cwd(),
          nodeBinaryPath: process.execPath,
          project,
          onFileProgress: () => {},
        }),
      ).rejects.toThrow(/Failed to run oxlint/);
    } finally {
      globalThis.setInterval = realSetInterval;
      globalThis.clearInterval = realClearInterval;
      // Force-clear any survivor so a regression fails the assertion below
      // instead of hanging the test process on the leaked timer.
      for (const handle of liveIntervalHandles) realClearInterval(handle);
    }

    expect(createdCount).toBeGreaterThanOrEqual(1);
    expect(liveIntervalHandles.size).toBe(0);
  });
});
