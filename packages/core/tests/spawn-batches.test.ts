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

import * as fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
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

/**
 * Verifies the `concurrency` option actually fans batches out across
 * parallel oxlint subprocesses. Each batch is stood in for by a `node -e`
 * script that brackets a short sleep with `+` / `-` marks in a shared file;
 * the peak nesting depth of those marks is the observed peak concurrency.
 * The scripts write nothing to stdout, so each "batch" parses to `[]` and
 * the run succeeds — the assertion is purely about how many ran at once.
 */
const SLEEP_MS = 200;

const computePeakConcurrency = (marks: string): number => {
  let depth = 0;
  let peak = 0;
  for (const mark of marks) {
    if (mark === "+") {
      depth += 1;
      peak = Math.max(peak, depth);
    } else if (mark === "-") {
      depth -= 1;
    }
  }
  return peak;
};

const runMarkedBatches = async (batchCount: number, concurrency: number): Promise<number> => {
  const markDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "rd-parallel-"));
  const markFile = path.join(markDirectory, "marks.txt");
  fs.writeFileSync(markFile, "");
  // O_APPEND single-byte writes are atomic across processes on POSIX, so the
  // mark stream is a faithful interleaving of the concurrent spawns.
  const sleepScript = `const fs=require("fs");const f=${JSON.stringify(markFile)};fs.appendFileSync(f,"+");setTimeout(()=>fs.appendFileSync(f,"-"),${SLEEP_MS});`;
  const fileBatches = Array.from({ length: batchCount }, (_unused, index) => [
    `src/file-${index}.tsx`,
  ]);

  try {
    const diagnostics = await spawnLintBatches({
      baseArgs: ["-e", sleepScript],
      fileBatches,
      rootDirectory: process.cwd(),
      nodeBinaryPath: process.execPath,
      project,
      concurrency,
    });
    expect(diagnostics).toEqual([]);
    return computePeakConcurrency(fs.readFileSync(markFile, "utf8"));
  } finally {
    fs.rmSync(markDirectory, { recursive: true, force: true });
  }
};

describe("spawnLintBatches concurrency", () => {
  it("runs batches in parallel up to the concurrency limit", async () => {
    const peak = await runMarkedBatches(6, 3);
    // Proves parallelism happened (>1) and that the cap is respected (<=3).
    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThanOrEqual(3);
  });

  it("runs batches serially when concurrency is 1", async () => {
    const peak = await runMarkedBatches(4, 1);
    expect(peak).toBe(1);
  });
});
