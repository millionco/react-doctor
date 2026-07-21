import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const SUCCESS_EXIT_CODE = 0;
const scriptPath = fileURLToPath(new URL("./compare-parity.mjs", import.meta.url));

const buildRepository = (name = "project", rootDir = ".") => ({
  org: "example",
  name,
  ref: "0123456789abcdef0123456789abcdef01234567",
  rootDir,
});

const buildLegacyDiagnostic = (overrides = {}) => ({
  filePath: "src/app.tsx",
  line: 1,
  column: 1,
  plugin: "react-doctor",
  rule: "example",
  severity: "warning",
  message: "Example diagnostic",
  help: "Fix the example.",
  category: "Correctness",
  ...overrides,
});

const buildV3Diagnostic = (overrides = {}) => ({
  ...buildLegacyDiagnostic(),
  id: "packages/ui/src/app.tsx::1:1::react-doctor/example::digest",
  normalizedFilePath: "src/app.tsx",
  tags: [],
  ...overrides,
});

const buildReport = ({
  schemaVersion = 3,
  directory = "/workspace/target",
  projects,
  diagnostics,
} = {}) => {
  const reportProjects = projects ?? [
    schemaVersion === 3
      ? {
          directory,
          packageRoot: directory,
          framework: "nextjs",
          project: {},
          diagnostics: [buildV3Diagnostic()],
          score: null,
          skippedChecks: [],
          analyzedFiles: ["src/app.tsx"],
          analyzedFileCount: 1,
          complete: true,
          elapsedMilliseconds: 1,
        }
      : {
          directory,
          project: { rootDirectory: directory },
          diagnostics: [buildLegacyDiagnostic()],
          score: null,
          skippedChecks: [],
          elapsedMilliseconds: 1,
        },
  ];
  const flattenedDiagnostics =
    diagnostics ?? reportProjects.flatMap((project) => project.diagnostics);
  return {
    schemaVersion,
    version: "0.8.1",
    ok: true,
    directory,
    mode: "full",
    diff: null,
    projects: reportProjects,
    diagnostics: flattenedDiagnostics,
    summary: {
      errorCount: flattenedDiagnostics.filter((diagnostic) => diagnostic.severity === "error")
        .length,
      warningCount: flattenedDiagnostics.filter((diagnostic) => diagnostic.severity === "warning")
        .length,
      affectedFileCount: new Set(flattenedDiagnostics.map((diagnostic) => diagnostic.filePath))
        .size,
      totalDiagnosticCount: flattenedDiagnostics.length,
      score: null,
      scoreLabel: null,
    },
    elapsedMilliseconds: 1,
    error: null,
  };
};

const buildRecord = (repository = buildRepository(), report = buildReport()) => ({
  schemaVersion: 1,
  repository,
  report,
});

const runComparison = (baselineRecords, candidateRecords) => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "react-doctor-parity-"));
  try {
    const baselinePath = join(temporaryDirectory, "baseline.ndjson");
    const candidatePath = join(temporaryDirectory, "candidate.ndjson");
    writeFileSync(
      baselinePath,
      baselineRecords.map((record) => JSON.stringify(record)).join("\n") + "\n",
    );
    writeFileSync(
      candidatePath,
      candidateRecords.map((record) => JSON.stringify(record)).join("\n") + "\n",
    );
    return spawnSync(process.execPath, [scriptPath, baselinePath, candidatePath], {
      encoding: "utf8",
    });
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
};

test("canonicalizes matching legacy and v3 diagnostics to report-relative identities", () => {
  const repository = buildRepository("workspace", "packages/ui");
  const legacyDiagnostic = buildLegacyDiagnostic();
  const baselineReport = buildReport({
    schemaVersion: 1,
    directory: "/workspace/target",
    projects: [
      {
        directory: "/workspace/target/packages/ui",
        project: { rootDirectory: "/workspace/target/packages/ui" },
        diagnostics: [legacyDiagnostic],
        score: null,
        skippedChecks: [],
        elapsedMilliseconds: 1,
      },
    ],
  });
  const candidateDiagnostic = buildV3Diagnostic();
  const candidateReport = buildReport({
    schemaVersion: 3,
    directory: "C:\\workspace\\target",
    projects: [
      {
        directory: "C:\\workspace\\target\\packages\\ui",
        packageRoot: "C:\\workspace\\target\\packages\\ui",
        framework: "nextjs",
        project: {},
        diagnostics: [candidateDiagnostic],
        score: null,
        skippedChecks: [],
        analyzedFiles: ["src/app.tsx"],
        analyzedFileCount: 1,
        complete: true,
        elapsedMilliseconds: 1,
      },
    ],
  });

  const result = runComparison(
    [buildRecord(repository, baselineReport)],
    [buildRecord(repository, candidateReport)],
  );

  assert.equal(result.status, SUCCESS_EXIT_CODE, result.stderr);
  const comparison = JSON.parse(result.stdout);
  assert.equal(comparison.summary.added, 0);
  assert.equal(comparison.summary.removed, 0);
  assert.equal(comparison.summary.unchanged, 1);
});

test("keeps same-named files in nested projects as distinct identities", () => {
  const firstDiagnostic = buildV3Diagnostic({
    id: "packages/first/package.json::0:0::react-doctor/example::first",
    normalizedFilePath: "package.json",
    filePath: "package.json",
    line: 0,
    column: 0,
  });
  const secondDiagnostic = {
    ...firstDiagnostic,
    id: "packages/second/package.json::0:0::react-doctor/example::second",
  };
  const projects = ["first", "second"].map((packageName, projectIndex) => ({
    directory: `/workspace/target/packages/${packageName}`,
    packageRoot: `/workspace/target/packages/${packageName}`,
    framework: "nextjs",
    project: {},
    diagnostics: [projectIndex === 0 ? firstDiagnostic : secondDiagnostic],
    score: null,
    skippedChecks: [],
    analyzedFiles: ["package.json"],
    analyzedFileCount: 1,
    complete: true,
    elapsedMilliseconds: 1,
  }));
  const record = buildRecord(buildRepository("workspace"), buildReport({ projects }));

  const result = runComparison([record], [record]);

  assert.equal(result.status, SUCCESS_EXIT_CODE, result.stderr);
  assert.equal(JSON.parse(result.stdout).summary.unchanged, 2);
});

test("does not count duplicate diagnostic identities more than once", () => {
  const diagnostic = buildV3Diagnostic();
  const addedDiagnostic = buildV3Diagnostic({
    id: "src/app.tsx::2:1::react-doctor/added::digest",
    line: 2,
    rule: "added",
  });
  const baselineReport = buildReport({
    projects: [
      {
        ...buildReport().projects[0],
        diagnostics: [diagnostic, diagnostic],
      },
    ],
    diagnostics: [diagnostic, diagnostic],
  });
  const candidateReport = buildReport({
    projects: [
      {
        ...buildReport().projects[0],
        diagnostics: [diagnostic, diagnostic, addedDiagnostic, addedDiagnostic],
      },
    ],
    diagnostics: [diagnostic, diagnostic, addedDiagnostic, addedDiagnostic],
  });

  const result = runComparison(
    [buildRecord(buildRepository(), baselineReport)],
    [buildRecord(buildRepository(), candidateReport)],
  );

  assert.equal(result.status, 1, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout).summary, {
    baselineProjects: 1,
    candidateProjects: 1,
    comparedProjects: 1,
    skippedProjects: 0,
    baselineDiagnostics: 1,
    candidateDiagnostics: 2,
    added: 1,
    removed: 0,
    unchanged: 1,
  });
});

test("classifies explicitly incomplete project reports as skipped", () => {
  const report = buildReport();
  report.projects[0].complete = false;
  const record = buildRecord(buildRepository(), report);

  const result = runComparison([record], [record]);

  assert.equal(result.status, 2, result.stderr);
  const comparison = JSON.parse(result.stdout);
  assert.equal(comparison.summary.comparedProjects, 0);
  assert.equal(comparison.summary.skippedProjects, 1);
  assert.equal(comparison.skippedProjects[0].baselineError, "1 project report is incomplete");
  assert.equal(comparison.skippedProjects[0].candidateError, "1 project report is incomplete");
});

for (const [name, mutateProject] of [
  ["skipped checks", (project) => (project.skippedChecks = ["lint"])],
  ["skipped check reasons", (project) => (project.skippedCheckReasons = { lint: "timed out" })],
  ["a mismatched scanned file count", (project) => (project.scannedFileCount = 2)],
]) {
  test(`rejects complete v3 reports with ${name}`, () => {
    const report = buildReport();
    mutateProject(report.projects[0]);
    const record = buildRecord(buildRepository(), report);

    const result = runComparison([record], [record]);

    assert.equal(result.status, 2, result.stderr);
    assert.equal(JSON.parse(result.stdout).summary.skippedProjects, 1);
  });
}

test("rejects missing v3 completion data", () => {
  const report = buildReport();
  Reflect.deleteProperty(report.projects[0], "complete");
  const record = buildRecord(buildRepository(), report);

  const result = runComparison([record], [record]);

  assert.equal(result.status, 2, result.stderr);
  assert.match(
    JSON.parse(result.stdout).skippedProjects[0].baselineError,
    /missing v3 project completion data/,
  );
});

test("rejects partial legacy project reports", () => {
  const report = buildReport({ schemaVersion: 1 });
  report.projects[0].skippedChecks = ["lint"];
  const record = buildRecord(buildRepository(), report);

  const result = runComparison([record], [record]);

  assert.equal(result.status, 2, result.stderr);
  assert.equal(JSON.parse(result.stdout).summary.skippedProjects, 1);
});

test("rejects malformed diagnostics and inconsistent flattened diagnostics", () => {
  const malformedReport = buildReport();
  malformedReport.projects[0].diagnostics[0].line = "1";
  malformedReport.diagnostics[0].line = "1";
  const mismatchedReport = buildReport();
  mismatchedReport.projects[0].diagnostics = [];

  const malformedResult = runComparison(
    [buildRecord(buildRepository(), malformedReport)],
    [buildRecord(buildRepository(), malformedReport)],
  );
  const mismatchedResult = runComparison(
    [buildRecord(buildRepository(), mismatchedReport)],
    [buildRecord(buildRepository(), mismatchedReport)],
  );

  assert.equal(malformedResult.status, 2, malformedResult.stderr);
  assert.equal(mismatchedResult.status, 2, mismatchedResult.stderr);
});

test("accepts semantically equal flattened diagnostics with reordered object keys", () => {
  const report = buildReport();
  const reorderedDiagnostic = Object.fromEntries(Object.entries(report.diagnostics[0]).reverse());
  report.diagnostics = [reorderedDiagnostic];
  const record = buildRecord(buildRepository(), report);

  const result = runComparison([record], [record]);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).summary.unchanged, 1);
});

test("rejects reports missing required schema fields", () => {
  const missingDiffReport = buildReport();
  Reflect.deleteProperty(missingDiffReport, "diff");
  const missingHelpReport = buildReport();
  Reflect.deleteProperty(missingHelpReport.diagnostics[0], "help");
  const missingProjectFieldReport = buildReport();
  Reflect.deleteProperty(missingProjectFieldReport.projects[0], "framework");

  const missingDiffResult = runComparison(
    [buildRecord(buildRepository(), missingDiffReport)],
    [buildRecord(buildRepository(), missingDiffReport)],
  );
  const missingHelpResult = runComparison(
    [buildRecord(buildRepository(), missingHelpReport)],
    [buildRecord(buildRepository(), missingHelpReport)],
  );
  const missingProjectFieldResult = runComparison(
    [buildRecord(buildRepository(), missingProjectFieldReport)],
    [buildRecord(buildRepository(), missingProjectFieldReport)],
  );

  assert.equal(missingDiffResult.status, 2, missingDiffResult.stderr);
  assert.equal(missingHelpResult.status, 2, missingHelpResult.stderr);
  assert.equal(missingProjectFieldResult.status, 2, missingProjectFieldResult.stderr);
});

test("accepts complete v2 reports and requires baseline data", () => {
  const completeV2Report = buildReport({ schemaVersion: 2 });
  completeV2Report.baseline = {
    baseRef: "0123456789abcdef0123456789abcdef01234567",
    newCount: 1,
    fixedCount: 0,
    baseTotalCount: 1,
  };
  const missingBaselineReport = buildReport({ schemaVersion: 2 });

  const completeResult = runComparison(
    [buildRecord(buildRepository(), completeV2Report)],
    [buildRecord(buildRepository(), completeV2Report)],
  );
  const missingResult = runComparison(
    [buildRecord(buildRepository(), missingBaselineReport)],
    [buildRecord(buildRepository(), missingBaselineReport)],
  );

  assert.equal(completeResult.status, 0, completeResult.stderr);
  assert.equal(missingResult.status, 2, missingResult.stderr);
});

test("rejects malformed repository refs before comparison", () => {
  const record = buildRecord({ ...buildRepository(), ref: "main" });

  const result = runComparison([record], [record]);

  assert.equal(result.status, 2);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /not a complete eval schema v1 record/);
});

test("rejects unsafe or noncanonical repository roots", () => {
  const record = buildRecord(buildRepository("project", "packages/web/../app"));

  const result = runComparison([record], [record]);

  assert.equal(result.status, 2);
  assert.equal(result.stdout, "");
});

test("produces byte-identical output regardless of record and diagnostic order", () => {
  const firstRepository = buildRepository("first");
  const secondRepository = buildRepository("second");
  const firstDiagnostic = buildV3Diagnostic({ rule: "first", id: "first-id" });
  const secondDiagnostic = buildV3Diagnostic({ rule: "second", id: "second-id", line: 2 });
  const buildOrderedRecord = (repository, diagnostics) =>
    buildRecord(
      repository,
      buildReport({
        projects: [{ ...buildReport().projects[0], diagnostics }],
        diagnostics,
      }),
    );
  const baselineForward = [
    buildOrderedRecord(firstRepository, [firstDiagnostic, secondDiagnostic]),
    buildOrderedRecord(secondRepository, [firstDiagnostic]),
  ];
  const candidateForward = [
    buildOrderedRecord(firstRepository, [secondDiagnostic]),
    buildOrderedRecord(secondRepository, [firstDiagnostic, secondDiagnostic]),
  ];
  const baselineReverse = [
    buildOrderedRecord(secondRepository, [firstDiagnostic]),
    buildOrderedRecord(firstRepository, [secondDiagnostic, firstDiagnostic]),
  ];
  const candidateReverse = [
    buildOrderedRecord(secondRepository, [secondDiagnostic, firstDiagnostic]),
    buildOrderedRecord(firstRepository, [secondDiagnostic]),
  ];

  const forwardResult = runComparison(baselineForward, candidateForward);
  const reverseResult = runComparison(baselineReverse, candidateReverse);

  assert.equal(forwardResult.status, 1, forwardResult.stderr);
  assert.equal(reverseResult.status, 1, reverseResult.stderr);
  assert.equal(forwardResult.stdout, reverseResult.stdout);
});
