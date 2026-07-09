/**
 * Covers the OOM rescue pass in `spawnLintBatches`: files dropped because
 * oxlint's native binding SIGABRT'd under memory pressure (the
 * `OxlintBatchExceeded { kind: "oom" }` class — oxc's fixed-size allocator
 * panics when N concurrent oxlint processes compete for memory) are replayed
 * once, serially, one single-file batch each. A transient, concurrency-driven
 * OOM clears on the replay and the scan completes instead of reporting a
 * partial result; a file that STILL aborts alone stays dropped and reported.
 *
 * The oxlint binary is stood in for by a `node -e` stub that aborts itself
 * via `process.abort()` on each file's first attempt (tracked via per-file
 * marker files) and emits one diagnostic per file on later attempts.
 * `process.abort()` raises a real SIGABRT on POSIX; on Windows — which has
 * no POSIX signals, so a self-aborting child can never surface a signal to
 * its parent — Node normalizes it to exit code 134 (`ExitCode::kAbort`),
 * which `spawnOxlint` folds into the same OOM class via `ABORT_EXIT_CODES`.
 */

import * as fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
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

let markerDirectory: string;

beforeEach(() => {
  markerDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "rd-oom-rescue-"));
});

afterEach(() => {
  fs.rmSync(markerDirectory, { recursive: true, force: true });
});

// Aborts on each file's FIRST attempt (per-file marker), then emits one
// oxlint-format diagnostic per file — modeling a concurrency-driven OOM that
// clears once the process runs alone.
const buildAbortOnceScript = (abortStatement = "process.abort();"): string =>
  [
    'const fs = require("fs");',
    'const path = require("path");',
    `const markerDirectory = ${JSON.stringify(markerDirectory)};`,
    "const files = process.argv.slice(1);",
    "const markerPathFor = (file) => path.join(markerDirectory, encodeURIComponent(file));",
    "const unattempted = files.filter((file) => !fs.existsSync(markerPathFor(file)));",
    "if (unattempted.length > 0) {",
    '  for (const file of unattempted) fs.writeFileSync(markerPathFor(file), "");',
    `  ${abortStatement}`,
    "}",
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

const ALWAYS_ABORT_SCRIPT = "process.abort();";

// "poison" files abort on their first attempt (so they enter the rescue),
// then print non-JSON stdout — a non-splittable `OxlintOutputUnparseable`
// that makes their rescue replay reject. Every other file aborts once when
// `abortAllOnce` is set (so it enters the rescue too), then lints normally.
const buildPoisonedRescueScript = (abortAllOnce = false): string =>
  [
    'const fs = require("fs");',
    'const path = require("path");',
    `const markerDirectory = ${JSON.stringify(markerDirectory)};`,
    "const files = process.argv.slice(1);",
    "const markerPathFor = (file) => path.join(markerDirectory, encodeURIComponent(file));",
    'const isPoison = (file) => file.includes("poison");',
    "const unattempted = files.filter(",
    `  (file) => (${abortAllOnce ? "true" : "false"} || isPoison(file)) && !fs.existsSync(markerPathFor(file)),`,
    ");",
    "if (unattempted.length > 0) {",
    '  for (const file of unattempted) fs.writeFileSync(markerPathFor(file), "");',
    "  process.abort();",
    "}",
    "if (files.some(isPoison)) {",
    '  process.stdout.write("oxlint panicked: definitely not json");',
    "  process.exit(0);",
    "}",
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

const runBatches = (
  script: string,
  concurrency: number,
  onPartialFailure?: (reason: string) => void,
) =>
  spawnLintBatches({
    baseArgs: ["-e", script],
    fileBatches: [["src/a.tsx"], ["src/b.tsx"]],
    rootDirectory: process.cwd(),
    nodeBinaryPath: process.execPath,
    project,
    concurrency,
    onPartialFailure,
  });

describe("spawnLintBatches — OOM rescue pass", () => {
  it("rescues files whose OOM was concurrency-driven and reports no partial failure", async () => {
    const partialFailures: string[] = [];

    const diagnostics = await runBatches(buildAbortOnceScript(), 2, (reason) =>
      partialFailures.push(reason),
    );

    expect(diagnostics.map((diagnostic) => diagnostic.filePath).sort()).toEqual([
      "src/a.tsx",
      "src/b.tsx",
    ]);
    expect(partialFailures).toEqual([]);
  });

  it("keeps files dropped when they still abort alone, and reports the OOM", async () => {
    const partialFailures: string[] = [];

    const diagnostics = await runBatches(ALWAYS_ABORT_SCRIPT, 2, (reason) =>
      partialFailures.push(reason),
    );

    expect(diagnostics).toEqual([]);
    expect(partialFailures).toHaveLength(1);
    expect(partialFailures[0]).toContain("2 file(s) failed to lint");
    expect(partialFailures[0]).toContain("ran out of memory");
  });

  it("falls back to the completed main pass when the rescue itself rejects", async () => {
    const partialFailures: string[] = [];

    const diagnostics = await spawnLintBatches({
      baseArgs: ["-e", buildPoisonedRescueScript()],
      fileBatches: [["src/one.tsx"], ["src/two.tsx"], ["src/poison.tsx"]],
      rootDirectory: process.cwd(),
      nodeBinaryPath: process.execPath,
      project,
      concurrency: 2,
      onPartialFailure: (reason) => partialFailures.push(reason),
    });

    // The rescue replay of poison.tsx dies on unparseable stdout (a
    // non-splittable error). The main pass already completed — its
    // diagnostics must survive and the poisoned file stays reported as
    // dropped, instead of the whole scan rejecting.
    expect(diagnostics.map((diagnostic) => diagnostic.filePath).sort()).toEqual([
      "src/one.tsx",
      "src/two.tsx",
    ]);
    expect(partialFailures).toHaveLength(1);
    expect(partialFailures[0]).toContain("1 file(s) failed to lint");
    expect(partialFailures[0]).toContain("src/poison.tsx");
  });

  it("keeps rescues that already succeeded when a later rescue fails", async () => {
    const partialFailures: string[] = [];

    const diagnostics = await spawnLintBatches({
      baseArgs: ["-e", buildPoisonedRescueScript(true)],
      fileBatches: [["src/a.tsx"], ["src/b.tsx"], ["src/poison.tsx"]],
      rootDirectory: process.cwd(),
      nodeBinaryPath: process.execPath,
      project,
      concurrency: 2,
      onPartialFailure: (reason) => partialFailures.push(reason),
    });

    // Every file OOMs once, so all three enter the serial rescue. The
    // poisoned file's replay dies on unparseable stdout (a non-splittable
    // error) — that failure must be isolated to the one file: the rescues
    // of a.tsx / b.tsx that succeeded around it keep their diagnostics and
    // leave the dropped list, instead of the whole rescue rejecting and
    // discarding them.
    expect(diagnostics.map((diagnostic) => diagnostic.filePath).sort()).toEqual([
      "src/a.tsx",
      "src/b.tsx",
    ]);
    expect(partialFailures).toHaveLength(1);
    expect(partialFailures[0]).toContain("1 file(s) failed to lint");
    expect(partialFailures[0]).toContain("src/poison.tsx");
    expect(partialFailures[0]).toContain("Failed to parse oxlint output");
  });

  it("rescues an abort surfaced as a bare exit code (the Windows shape)", async () => {
    const partialFailures: string[] = [];

    // Windows never reports a signal for a self-aborting child — only exit
    // code 134 (`ExitCode::kAbort`). Exit that way explicitly so the
    // `ABORT_EXIT_CODES` detection branch is exercised on every platform.
    const diagnostics = await runBatches(buildAbortOnceScript("process.exit(134);"), 2, (reason) =>
      partialFailures.push(reason),
    );

    expect(diagnostics.map((diagnostic) => diagnostic.filePath).sort()).toEqual([
      "src/a.tsx",
      "src/b.tsx",
    ]);
    expect(partialFailures).toEqual([]);
  });

  it("does not rescue on an already-serial run (nothing to de-contend)", async () => {
    const partialFailures: string[] = [];

    const diagnostics = await runBatches(buildAbortOnceScript(), 1, (reason) =>
      partialFailures.push(reason),
    );

    // Serial run: each file's single attempt aborts and stays dropped — the
    // rescue only exists to remove sibling-process memory pressure.
    expect(diagnostics).toEqual([]);
    expect(partialFailures).toHaveLength(1);
    expect(partialFailures[0]).toContain("2 file(s) failed to lint");
  });
});
