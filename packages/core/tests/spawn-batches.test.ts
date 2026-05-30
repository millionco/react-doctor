/**
 * Regression test for issue #599 — `react-doctor --staged` hangs after
 * printing results.
 *
 * `spawnLintBatches` starts a ref'd `setInterval` progress timer for each
 * multi-file batch and used to clear it on a statement that only ran once
 * `await spawnLintBatch(batch)` had *resolved*. When a batch instead
 * rejects with a non-splittable error (e.g. an adopted lint config
 * crashing oxlint), that statement was skipped and the timer leaked. The
 * caller (`runOxlint`) then silently retried with `extends` stripped and
 * succeeded, so the scan finished and printed output — but the orphaned
 * timer kept the Node event loop alive and the CLI never exited (the CLI
 * relies on natural event-loop drain + `process.exitCode`, not on
 * `process.exit()`).
 *
 * The fix wraps the batch in `try/finally`, so the timer is cleared on
 * BOTH the resolve and reject paths. We assert that by instrumenting
 * `setInterval` / `clearInterval` around a `spawnLintBatches` call whose
 * batch is forced to reject, and confirming no interval survives.
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

// A multi-file batch so the progress interval is actually created
// (`batch.length > 1`), with `onFileProgress` wired — the human inspect
// path always passes it. Both are preconditions for the leak.
const fileBatches = [["src/a.tsx", "src/b.tsx"]];

// HACK: stand in for the oxlint binary with `node -e <script>`, so each
// scenario can pick the failure shape (write stderr + exit 0 → empty
// stdout → a non-splittable `OxlintSpawnFailed`, exactly how an adopted
// lint config crashing oxlint surfaces) or the success shape (valid JSON
// on stdout) without a real oxlint install.
const runBatchesWith = (baseArgs: ReadonlyArray<string>) =>
  spawnLintBatches({
    baseArgs,
    fileBatches,
    rootDirectory: process.cwd(),
    nodeBinaryPath: process.execPath,
    project,
    onFileProgress: () => {},
  });

/**
 * Runs `runScenario` with `setInterval` / `clearInterval` instrumented so
 * the test can assert no progress timer outlives the call. Globals are
 * always restored and any survivor is force-cleared in `finally`, so a
 * regression here can't hang the test process itself.
 */
const trackIntervals = async (runScenario: () => Promise<void>) => {
  const realSetInterval = globalThis.setInterval;
  const realClearInterval = globalThis.clearInterval;
  const liveIntervalHandles = new Set<ReturnType<typeof setInterval>>();
  let createdCount = 0;
  let leakedCount = 0;

  // HACK: reassigning the timer globals is the only way to observe the
  // interval handles the runner creates internally.
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
    await runScenario();
  } finally {
    globalThis.setInterval = realSetInterval;
    globalThis.clearInterval = realClearInterval;
    leakedCount = liveIntervalHandles.size;
    for (const handle of liveIntervalHandles) realClearInterval(handle);
  }

  return { createdCount, leakedCount };
};

describe("issue #599: spawnLintBatches never leaks its progress interval", () => {
  it("clears the progress timer when a multi-file batch rejects with a non-splittable error", async () => {
    const { createdCount, leakedCount } = await trackIntervals(async () => {
      await expect(runBatchesWith(["-e", "process.stderr.write('boom')"])).rejects.toThrow(
        /Failed to run oxlint/,
      );
    });

    expect(createdCount).toBeGreaterThanOrEqual(1);
    expect(leakedCount).toBe(0);
  });

  it("clears the progress timer on the success path too", async () => {
    const oxlintJson = JSON.stringify({ diagnostics: [] });
    const { createdCount, leakedCount } = await trackIntervals(async () => {
      const diagnostics = await runBatchesWith([
        "-e",
        `process.stdout.write(${JSON.stringify(oxlintJson)})`,
      ]);
      expect(diagnostics).toEqual([]);
    });

    expect(createdCount).toBeGreaterThanOrEqual(1);
    expect(leakedCount).toBe(0);
  });
});
