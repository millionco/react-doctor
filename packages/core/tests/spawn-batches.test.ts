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

type IntervalHandle = ReturnType<typeof setInterval>;

const buildProject = (overrides: Partial<ProjectInfo> = {}): ProjectInfo => ({
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
  ...overrides,
});

/**
 * Runs `fn` with `setInterval` / `clearInterval` instrumented so the test
 * can assert no progress timer outlives the call. Globals are always
 * restored and any survivor is force-cleared in `finally`, so a
 * regression here can't hang the test process itself.
 */
const trackIntervals = async (
  fn: () => Promise<void>,
): Promise<{ created: number; leaked: number }> => {
  const realSetInterval = globalThis.setInterval;
  const realClearInterval = globalThis.clearInterval;
  const live = new Set<IntervalHandle>();
  let created = 0;
  let leaked = 0;

  globalThis.setInterval = ((...args: Parameters<typeof setInterval>) => {
    const handle = realSetInterval(...args);
    live.add(handle);
    created += 1;
    return handle;
  }) as typeof setInterval;
  globalThis.clearInterval = ((handle?: IntervalHandle) => {
    if (handle !== undefined) live.delete(handle);
    realClearInterval(handle);
  }) as typeof clearInterval;

  try {
    await fn();
  } finally {
    globalThis.setInterval = realSetInterval;
    globalThis.clearInterval = realClearInterval;
    leaked = live.size;
    for (const handle of live) realClearInterval(handle);
  }

  return { created, leaked };
};

// A multi-file batch so the progress interval is actually created
// (`batch.length > 1`), with `onFileProgress` wired — the human inspect
// path always passes it. Both are preconditions for the leak.
const fileBatches = [["src/a.tsx", "src/b.tsx"]];

describe("issue #599: spawnLintBatches never leaks its progress interval", () => {
  it("clears the progress timer when a multi-file batch rejects with a non-splittable error", async () => {
    // `baseArgs` make `spawnOxlint` run `node -e <script> …files`. The
    // script writes to stderr and exits 0 → empty stdout + non-empty
    // stderr → a non-splittable `OxlintSpawnFailed`, exactly how an
    // adopted lint config crashing oxlint surfaces. `spawnLintBatch`
    // re-throws it, so the whole call rejects before the post-`await`
    // cleanup the old code relied on.
    const { created, leaked } = await trackIntervals(async () => {
      await expect(
        spawnLintBatches({
          baseArgs: ["-e", "process.stderr.write('boom')"],
          fileBatches,
          rootDirectory: process.cwd(),
          nodeBinaryPath: process.execPath,
          project: buildProject(),
          onFileProgress: () => {},
          spawnTimeoutMs: 30_000,
        }),
      ).rejects.toThrow(/Failed to run oxlint/);
    });

    expect(created).toBeGreaterThanOrEqual(1);
    expect(leaked).toBe(0);
  });

  it("clears the progress timer on the success path too", async () => {
    const oxlintJson = JSON.stringify({ diagnostics: [] });
    const { created, leaked } = await trackIntervals(async () => {
      const diagnostics = await spawnLintBatches({
        baseArgs: ["-e", `process.stdout.write(${JSON.stringify(oxlintJson)})`],
        fileBatches,
        rootDirectory: process.cwd(),
        nodeBinaryPath: process.execPath,
        project: buildProject(),
        onFileProgress: () => {},
        spawnTimeoutMs: 30_000,
      });
      expect(diagnostics).toEqual([]);
    });

    expect(created).toBeGreaterThanOrEqual(1);
    expect(leaked).toBe(0);
  });
});
