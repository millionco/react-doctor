/**
 * `--max-duration` graceful degradation: once `deadlineEpochMs` passes,
 * batches that haven't spawned are skipped and reported via
 * `onPartialFailure` (with the file list), while already-collected
 * diagnostics are still returned — a partial result instead of the empty
 * `{"ok":false,"projects":[]}` report a SIGTERM'd scan produced.
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
  sourceFileCount: 3,
};

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

describe("spawnLintBatches — max-duration deadline", () => {
  it("skips remaining batches past the deadline and reports the skipped files", async () => {
    const partialFailures: string[] = [];

    const diagnostics = await spawnLintBatches({
      baseArgs: ["-e", EMIT_ONE_DIAGNOSTIC_PER_FILE_SCRIPT],
      fileBatches: [["src/a.tsx"], ["src/b.tsx"], ["src/c.tsx"]],
      rootDirectory: process.cwd(),
      nodeBinaryPath: process.execPath,
      project,
      deadlineEpochMs: Date.now() - 1,
      onPartialFailure: (reason) => partialFailures.push(reason),
    });

    expect(diagnostics).toEqual([]);
    expect(partialFailures).toHaveLength(1);
    expect(partialFailures[0]).toContain("3 file(s) skipped");
    expect(partialFailures[0]).toContain("max scan duration reached");
    expect(partialFailures[0]).toContain("src/a.tsx");
  });

  it("lints every batch when the deadline has not passed", async () => {
    const partialFailures: string[] = [];

    const diagnostics = await spawnLintBatches({
      baseArgs: ["-e", EMIT_ONE_DIAGNOSTIC_PER_FILE_SCRIPT],
      fileBatches: [["src/a.tsx"], ["src/b.tsx"]],
      rootDirectory: process.cwd(),
      nodeBinaryPath: process.execPath,
      project,
      deadlineEpochMs: Date.now() + 60_000,
      onPartialFailure: (reason) => partialFailures.push(reason),
    });

    expect(diagnostics.map((diagnostic) => diagnostic.filePath).sort()).toEqual([
      "src/a.tsx",
      "src/b.tsx",
    ]);
    expect(partialFailures).toEqual([]);
  });
});
