import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const filterPath = fileURLToPath(new URL("./validate-parity-input.jq", import.meta.url));

const buildDiagnostic = () => ({
  id: "src/app.tsx::1:1::react-doctor/example::digest",
  normalizedFilePath: "src/app.tsx",
  filePath: "src/app.tsx",
  line: 1,
  column: 1,
  plugin: "react-doctor",
  rule: "example",
  severity: "warning",
  message: "Example diagnostic",
  help: "Fix the example.",
  category: "Correctness",
  tags: [],
});

const buildRecord = () => {
  const diagnostic = buildDiagnostic();
  return {
    schemaVersion: 1,
    repository: {
      org: "example",
      name: "project",
      ref: "0123456789abcdef0123456789abcdef01234567",
      rootDir: ".",
    },
    report: {
      schemaVersion: 3,
      version: "0.8.1",
      ok: true,
      directory: "/workspace/target",
      mode: "full",
      diff: null,
      projects: [
        {
          directory: "/workspace/target",
          packageRoot: "/workspace/target",
          framework: "nextjs",
          project: {},
          diagnostics: [diagnostic],
          score: null,
          skippedChecks: [],
          analyzedFiles: ["src/app.tsx"],
          analyzedFileCount: 1,
          complete: true,
          elapsedMilliseconds: 1,
        },
      ],
      diagnostics: [diagnostic],
      summary: {
        errorCount: 0,
        warningCount: 1,
        affectedFileCount: 1,
        totalDiagnosticCount: 1,
        score: null,
        scoreLabel: null,
      },
      elapsedMilliseconds: 1,
      error: null,
    },
  };
};

const validateInput = (contents) => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "react-doctor-parity-preflight-"));
  try {
    const inputPath = join(temporaryDirectory, "input.ndjson");
    writeFileSync(inputPath, contents);
    return spawnSync("jq", ["-e", "-n", "-f", filterPath, inputPath], { encoding: "utf8" });
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
};

const validateRecords = (records) =>
  validateInput(records.map((record) => JSON.stringify(record)).join("\n"));

test("accepts multiple complete pinned evaluation records", () => {
  const secondRecord = buildRecord();
  secondRecord.repository.name = "other";
  const result = validateRecords([buildRecord(), secondRecord]);

  assert.equal(result.status, 0, result.stderr);
});

test("rejects duplicate project records", () => {
  const result = validateRecords([buildRecord(), buildRecord()]);

  assert.equal(result.status, 1, result.stderr);
});

test("rejects an empty input", () => {
  const result = validateRecords([]);

  assert.equal(result.status, 1, result.stderr);
});

test("rejects malformed JSON", () => {
  const result = validateInput("{");

  assert.notEqual(result.status, 0);
});

for (const [name, mutateRecord] of [
  ["an unpinned ref", (record) => (record.repository.ref = "HEAD")],
  ["an evaluation error", (record) => (record.error = "Sandbox failed")],
  ["an incomplete project", (record) => (record.report.projects[0].complete = false)],
  [
    "a contradictory completed project with skipped checks",
    (record) => (record.report.projects[0].skippedChecks = ["lint"]),
  ],
  [
    "a contradictory completed project with skipped reasons",
    (record) => (record.report.projects[0].skippedCheckReasons = { lint: "timed out" }),
  ],
  ["a mismatched scanned file count", (record) => (record.report.projects[0].scannedFileCount = 2)],
  [
    "missing completion data",
    (record) => Reflect.deleteProperty(record.report.projects[0], "complete"),
  ],
  ["a malformed diagnostic", (record) => (record.report.diagnostics[0].line = "1")],
  [
    "a diagnostic missing required fields",
    (record) => Reflect.deleteProperty(record.report.diagnostics[0], "help"),
  ],
  [
    "a project missing required fields",
    (record) => Reflect.deleteProperty(record.report.projects[0], "framework"),
  ],
  ["an inconsistent summary", (record) => (record.report.summary.totalDiagnosticCount = 0)],
]) {
  test(`rejects ${name}`, () => {
    const record = buildRecord();
    mutateRecord(record);

    const result = validateRecords([record]);

    assert.equal(result.status, 1, result.stderr);
  });
}
