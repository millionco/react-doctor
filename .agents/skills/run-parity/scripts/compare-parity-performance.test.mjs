import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";

const SUCCESS_EXIT_CODE = 0;
const REGRESSION_EXIT_CODE = 1;
const INVALID_INPUT_EXIT_CODE = 2;
const scriptPath = fileURLToPath(new URL("./compare-parity-performance.mjs", import.meta.url));

const buildRecord = ({
  name = "project",
  elapsedMilliseconds = 10_000,
  analyzedFiles = ["src/app.tsx"],
  complete = true,
  ruleKeys = ["react-doctor/example"],
} = {}) => {
  const directory = "/workspace/target";
  return {
    schemaVersion: 1,
    repository: {
      org: "example",
      name,
      ref: "0123456789abcdef0123456789abcdef01234567",
      rootDir: ".",
    },
    evaluation: {
      reactDoctorRepository: "https://github.com/millionco/react-doctor.git",
      reactDoctorCommit: "abcdef0123456789abcdef0123456789abcdef01",
      configContract: "eval-config-v1",
      ruleSetHash: "rule-set",
      ruleKeys,
      evaluatorSourceHash: "evaluator-source",
    },
    report: {
      schemaVersion: 3,
      version: "0.9.3",
      ok: true,
      directory,
      mode: "full",
      diff: null,
      projects: [
        {
          directory,
          packageRoot: directory,
          framework: "vite",
          project: {},
          diagnostics: [],
          score: null,
          skippedChecks: [],
          analyzedFiles,
          analyzedFileCount: analyzedFiles.length,
          scannedFileCount: analyzedFiles.length,
          complete,
          elapsedMilliseconds,
        },
      ],
      diagnostics: [],
      summary: {
        errorCount: 0,
        warningCount: 0,
        affectedFileCount: 0,
        totalDiagnosticCount: 0,
        score: null,
        scoreLabel: null,
      },
      elapsedMilliseconds,
      error: null,
    },
  };
};

const runComparison = (baselineRecords, candidateRecords) => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "react-doctor-performance-test-"));
  try {
    const baselinePath = join(temporaryDirectory, "baseline.ndjson");
    const candidatePath = join(temporaryDirectory, "candidate.ndjson");
    writeFileSync(
      baselinePath,
      `${baselineRecords.map((record) => JSON.stringify(record)).join("\n")}\n`,
    );
    writeFileSync(
      candidatePath,
      `${candidateRecords.map((record) => JSON.stringify(record)).join("\n")}\n`,
    );
    return spawnSync(process.execPath, [scriptPath, baselinePath, candidatePath], {
      encoding: "utf8",
    });
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
};

test("accepts stable paired measurements", () => {
  const baseline = buildRecord();
  const candidate = buildRecord({ elapsedMilliseconds: 11_000 });
  const result = runComparison([baseline], [candidate]);

  assert.equal(result.status, SUCCESS_EXIT_CODE, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.summary.projectRegressions, 0);
  assert.equal(output.summary.ratio, 1.1);
});

test("fails on a material single-project regression", () => {
  const baseline = buildRecord();
  const candidate = buildRecord({ elapsedMilliseconds: 16_000 });
  const result = runComparison([baseline], [candidate]);

  assert.equal(result.status, REGRESSION_EXIT_CODE, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.summary.projectRegressions, 1);
  assert.equal(output.regressions[0].ratio, 1.6);
});

test("ignores high ratios whose absolute duration is too small", () => {
  const baseline = buildRecord({ elapsedMilliseconds: 500 });
  const candidate = buildRecord({ elapsedMilliseconds: 2_000 });
  const result = runComparison([baseline], [candidate]);

  assert.equal(result.status, SUCCESS_EXIT_CODE, result.stderr);
  assert.equal(JSON.parse(result.stdout).summary.eligibleProjects, 0);
});

test("fails on a broad aggregate regression below the per-project ratio threshold", () => {
  const baselineRecords = Array.from({ length: 10 }, (_, index) =>
    buildRecord({ name: `project-${index}`, elapsedMilliseconds: 10_000 }),
  );
  const candidateRecords = Array.from({ length: 10 }, (_, index) =>
    buildRecord({ name: `project-${index}`, elapsedMilliseconds: 12_500 }),
  );
  const result = runComparison(baselineRecords, candidateRecords);

  assert.equal(result.status, REGRESSION_EXIT_CODE, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.summary.projectRegressions, 0);
  assert.equal(output.summary.aggregateRegression, true);
  assert.equal(output.summary.ratio, 1.25);
});

test("rejects coverage drift", () => {
  const baseline = buildRecord();
  const candidate = buildRecord({ analyzedFiles: ["src/other.tsx"] });
  const result = runComparison([baseline], [candidate]);

  assert.equal(result.status, INVALID_INPUT_EXIT_CODE);
  assert.match(result.stderr, /coverage differs from baseline/);
});

test("rejects incomplete reports", () => {
  const baseline = buildRecord();
  const candidate = buildRecord({ complete: false });
  const result = runComparison([baseline], [candidate]);

  assert.equal(result.status, INVALID_INPUT_EXIT_CODE);
  assert.match(result.stderr, /project report is incomplete/);
});
