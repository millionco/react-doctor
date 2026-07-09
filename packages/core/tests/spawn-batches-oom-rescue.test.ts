/**
 * Covers the OOM rescue pass in `spawnLintBatches`: files dropped because
 * oxlint's native binding SIGABRT'd under memory pressure (the
 * `OxlintBatchExceeded { kind: "oom" }` class — oxc's fixed-size allocator
 * panics when N concurrent oxlint processes compete for memory) are replayed
 * once, serially, one single-file batch each. A transient, concurrency-driven
 * OOM clears on the replay and the scan completes instead of reporting a
 * partial result; a file that STILL aborts alone stays dropped and reported.
 *
 * The oxlint binary is stood in for by a `node -e` stub that SIGABRTs itself
 * on each file's first attempt (tracked via per-file marker files) and emits
 * one diagnostic per file on later attempts.
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

// SIGABRTs on each file's FIRST attempt (per-file marker), then emits one
// oxlint-format diagnostic per file — modeling a concurrency-driven OOM that
// clears once the process runs alone.
const buildAbortOnceScript = (): string =>
  [
    'const fs = require("fs");',
    'const path = require("path");',
    `const markerDirectory = ${JSON.stringify(markerDirectory)};`,
    "const files = process.argv.slice(1);",
    "const markerPathFor = (file) => path.join(markerDirectory, encodeURIComponent(file));",
    "const unattempted = files.filter((file) => !fs.existsSync(markerPathFor(file)));",
    "if (unattempted.length > 0) {",
    '  for (const file of unattempted) fs.writeFileSync(markerPathFor(file), "");',
    '  process.kill(process.pid, "SIGABRT");',
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

const ALWAYS_ABORT_SCRIPT = 'process.kill(process.pid, "SIGABRT");';

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
