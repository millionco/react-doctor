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

/**
 * LPT-invariance guard for the cost-aware batch ordering: reordering the
 * input batches must not change the deduped diagnostic SET (only its arrival
 * order, which the downstream `sortDiagnosticsStable` then makes canonical).
 * Each `node -e` stub emits one oxlint-format diagnostic per file argument, so
 * a faithful set comparison across two batch orders is possible without oxlint.
 */
const EMIT_ONE_DIAGNOSTIC_PER_FILE_SCRIPT = [
  "const files = process.argv.slice(1);",
  "const diagnostics = files.map((filename) => ({",
  '  message: "Array index used as a key",',
  '  code: "react-doctor(no-array-index-as-key)",',
  '  severity: "warning",',
  '  causes: [], url: "", help: "",',
  "  filename,",
  '  labels: [{ label: "", span: { offset: 0, length: 1, line: 1, column: 1 } }],',
  "  related: [],",
  "}));",
  "process.stdout.write(JSON.stringify({ diagnostics, number_of_files: files.length, number_of_rules: 1 }));",
].join("\n");

const lintFileBatches = (fileBatches: string[][]) =>
  spawnLintBatches({
    baseArgs: ["-e", EMIT_ONE_DIAGNOSTIC_PER_FILE_SCRIPT],
    fileBatches,
    rootDirectory: process.cwd(),
    nodeBinaryPath: process.execPath,
    project,
    concurrency: 4,
  });

const sortByFilePath = (diagnostics: Awaited<ReturnType<typeof lintFileBatches>>) =>
  [...diagnostics].sort((left, right) => left.filePath.localeCompare(right.filePath));

describe("spawnLintBatches — LPT batch-order invariance", () => {
  it("returns the same deduped diagnostic set regardless of batch input order", async () => {
    const forwardOrder = [["src/a.tsx"], ["src/b.tsx"], ["src/c.tsx"]];
    const reversedOrder = [["src/c.tsx"], ["src/b.tsx"], ["src/a.tsx"]];

    const fromForward = await lintFileBatches(forwardOrder);
    const fromReversed = await lintFileBatches(reversedOrder);

    expect(sortByFilePath(fromForward)).toEqual(sortByFilePath(fromReversed));
    expect(fromForward.map((diagnostic) => diagnostic.filePath).sort()).toEqual([
      "src/a.tsx",
      "src/b.tsx",
      "src/c.tsx",
    ]);
  });

  it("reports the exact sorted, deduplicated files analyzed successfully", async () => {
    let analyzedFiles: ReadonlyArray<string> = [];
    await spawnLintBatches({
      baseArgs: ["-e", EMIT_ONE_DIAGNOSTIC_PER_FILE_SCRIPT],
      fileBatches: [["src/b.tsx", "src/a.tsx"], ["src/a.tsx"]],
      rootDirectory: process.cwd(),
      nodeBinaryPath: process.execPath,
      project,
      onAnalyzedFiles: (filePaths) => {
        analyzedFiles = filePaths;
      },
    });
    expect(analyzedFiles).toEqual(["src/a.tsx", "src/b.tsx"]);
  });
});

/**
 * `--max-duration` graceful degradation: once `deadlineEpochMs` passes,
 * batches that haven't spawned are skipped and reported via
 * `onPartialFailure` (with the file list), while already-collected
 * diagnostics are still returned — a partial result instead of the empty
 * `{"ok":false,"projects":[]}` report a SIGTERM'd scan produced.
 */
const lintFileBatchesWithDeadline = (fileBatches: string[][], deadlineEpochMs: number) => {
  const partialFailures: string[] = [];
  let analyzedFiles: ReadonlyArray<string> = [];
  const diagnostics = spawnLintBatches({
    baseArgs: ["-e", EMIT_ONE_DIAGNOSTIC_PER_FILE_SCRIPT],
    fileBatches,
    rootDirectory: process.cwd(),
    nodeBinaryPath: process.execPath,
    project,
    deadlineEpochMs,
    onPartialFailure: (reason) => partialFailures.push(reason),
    onAnalyzedFiles: (filePaths) => {
      analyzedFiles = filePaths;
    },
  });
  return { diagnostics, partialFailures, readAnalyzedFiles: () => analyzedFiles };
};

describe("spawnLintBatches — max-duration deadline", () => {
  it("skips remaining batches past the deadline and reports the skipped files", async () => {
    const { diagnostics, partialFailures, readAnalyzedFiles } = lintFileBatchesWithDeadline(
      [["src/a.tsx"], ["src/b.tsx"], ["src/c.tsx"]],
      Date.now() - 1,
    );

    expect(await diagnostics).toEqual([]);
    expect(partialFailures).toHaveLength(1);
    expect(partialFailures[0]).toContain("3 file(s) skipped");
    expect(partialFailures[0]).toContain("max scan duration reached");
    expect(partialFailures[0]).toContain("src/a.tsx");
    expect(readAnalyzedFiles()).toEqual([]);
  });

  it("stops binary-split retries once the deadline passes mid-batch", async () => {
    const partialFailures: string[] = [];

    // One splittable-failing batch (spawn timeout) whose FIRST spawn starts
    // inside the budget: the timeout can't fire before the deadline does at
    // any split level after that, so every file must end deadline-skipped —
    // never endlessly re-split — regardless of machine speed.
    const diagnostics = await spawnLintBatches({
      baseArgs: ["-e", "setTimeout(() => {}, 10_000);"],
      fileBatches: [["src/a.tsx", "src/b.tsx", "src/c.tsx", "src/d.tsx"]],
      rootDirectory: process.cwd(),
      nodeBinaryPath: process.execPath,
      project,
      spawnTimeoutMs: 300,
      deadlineEpochMs: Date.now() + 450,
      onPartialFailure: (reason) => partialFailures.push(reason),
    });

    expect(diagnostics).toEqual([]);
    expect(partialFailures).toHaveLength(1);
    expect(partialFailures[0]).toContain("4 file(s) skipped");
    expect(partialFailures[0]).toContain("max scan duration reached");
  });

  it("attributes a single-file timeout past the deadline as a skip, not a drop", async () => {
    const partialFailures: string[] = [];

    // A lone-file batch starts inside the budget (top-of-fn check passes) but
    // its spawn times out AFTER the deadline (spawn timeout 200ms > 100ms
    // budget). It reaches the catch as a splittable, single-file failure — it
    // must be reported as a max-duration skip, not a pathological drop.
    const diagnostics = await spawnLintBatches({
      baseArgs: ["-e", "setTimeout(() => {}, 10_000);"],
      fileBatches: [["src/a.tsx"]],
      rootDirectory: process.cwd(),
      nodeBinaryPath: process.execPath,
      project,
      spawnTimeoutMs: 200,
      deadlineEpochMs: Date.now() + 100,
      onPartialFailure: (reason) => partialFailures.push(reason),
    });

    expect(diagnostics).toEqual([]);
    expect(partialFailures).toHaveLength(1);
    expect(partialFailures[0]).toContain("1 file(s) skipped");
    expect(partialFailures[0]).toContain("max scan duration reached");
    expect(partialFailures[0]).not.toContain("failed to lint");
  });

  it("lints every batch when the deadline has not passed", async () => {
    const { diagnostics, partialFailures } = lintFileBatchesWithDeadline(
      [["src/a.tsx"], ["src/b.tsx"]],
      Date.now() + 60_000,
    );

    expect((await diagnostics).map((diagnostic) => diagnostic.filePath).sort()).toEqual([
      "src/a.tsx",
      "src/b.tsx",
    ]);
    expect(partialFailures).toEqual([]);
  });
});
