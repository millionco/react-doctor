import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const SUCCESS_EXIT_CODE = 0;
const scriptPath = fileURLToPath(new URL("./compare-parity.mjs", import.meta.url));
const scriptDirectory = fileURLToPath(new URL(".", import.meta.url));

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

const runComparison = (
  baselineRecords,
  candidateRecords,
  ruleKeys = null,
  useRelativeScriptPath = false,
) => {
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
    const comparisonArguments = [useRelativeScriptPath ? "./compare-parity.mjs" : scriptPath];
    if (ruleKeys !== null) {
      const ruleKeysPath = join(temporaryDirectory, "rules.json");
      writeFileSync(ruleKeysPath, JSON.stringify(ruleKeys));
      comparisonArguments.push("--rules", ruleKeysPath);
    }
    comparisonArguments.push(baselinePath, candidatePath);
    return spawnSync(process.execPath, comparisonArguments, {
      encoding: "utf8",
      cwd: useRelativeScriptPath ? scriptDirectory : undefined,
    });
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
};

test("runs the comparator through a relative CLI script path", () => {
  const record = buildRecord();
  const result = runComparison([record], [record], null, true);

  assert.equal(result.status, SUCCESS_EXIT_CODE, result.stderr);
  assert.equal(JSON.parse(result.stdout).summary.unchanged, 1);
});

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

test("accepts canonical rule keys with camelCase rule segments", () => {
  const diagnostic = buildV3Diagnostic({
    id: "src/app.tsx::1:1::react-doctor/no-derived-useState::digest",
    rule: "no-derived-useState",
  });
  const record = buildRecord(
    buildRepository(),
    buildReport({
      diagnostics: [diagnostic],
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
    }),
  );
  const result = runComparison([record], [record], ["react-doctor/no-derived-useState"]);

  assert.equal(result.status, SUCCESS_EXIT_CODE, result.stderr);
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

test("accepts complete Astro project reports", () => {
  const report = buildReport();
  report.projects[0].framework = "astro";
  const record = buildRecord(buildRepository(), report);

  const result = runComparison([record], [record]);

  assert.equal(result.status, SUCCESS_EXIT_CODE, result.stderr);
  assert.equal(JSON.parse(result.stdout).summary.unchanged, 1);
});

test("preserves duplicate diagnostic multiplicity", () => {
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
    baselineDiagnostics: 2,
    candidateDiagnostics: 4,
    added: 2,
    removed: 0,
    unchanged: 2,
  });
});

test("compares only selected rule diagnostics against a full baseline", () => {
  const selectedDiagnostic = buildV3Diagnostic();
  const unselectedDiagnostic = buildV3Diagnostic({
    id: "src/app.tsx::2:1::react-doctor/unselected::digest",
    line: 2,
    rule: "unselected",
  });
  const baselineReport = buildReport({
    projects: [
      {
        ...buildReport().projects[0],
        diagnostics: [selectedDiagnostic, unselectedDiagnostic],
      },
    ],
    diagnostics: [selectedDiagnostic, unselectedDiagnostic],
  });
  const candidateReport = buildReport({
    projects: [{ ...buildReport().projects[0], diagnostics: [selectedDiagnostic] }],
    diagnostics: [selectedDiagnostic],
  });

  const result = runComparison(
    [buildRecord(buildRepository(), baselineReport)],
    [buildRecord(buildRepository(), candidateReport)],
    ["react-doctor/example"],
  );

  assert.equal(result.status, SUCCESS_EXIT_CODE, result.stderr);
  const comparison = JSON.parse(result.stdout);
  assert.deepEqual(comparison.ruleScope, ["react-doctor/example"]);
  assert.equal(comparison.summary.baselineDiagnostics, 1);
  assert.equal(comparison.summary.candidateDiagnostics, 1);
  assert.equal(comparison.summary.unchanged, 1);
});

test("compares always-on TypeScript and environment diagnostics within a rule scope", () => {
  const selectedDiagnostic = buildV3Diagnostic();
  const typescriptDiagnostic = buildV3Diagnostic({
    id: "src/types.ts::1:1::TS/8011::digest",
    normalizedFilePath: "src/types.ts",
    filePath: "src/types.ts",
    plugin: "TS",
    rule: "8011",
    message: "Type annotations can only be used in TypeScript files.",
  });
  const environmentDiagnostic = buildV3Diagnostic({
    id: "package.json::0:0::react-doctor/require-pnpm-hardening::digest",
    normalizedFilePath: "package.json",
    filePath: "package.json",
    line: 0,
    column: 0,
    rule: "require-pnpm-hardening",
  });
  const unselectedDiagnostic = buildV3Diagnostic({
    id: "src/app.tsx::2:1::react-doctor/unselected::digest",
    line: 2,
    rule: "unselected",
  });
  const buildScopedReport = (diagnostics) =>
    buildReport({
      projects: [{ ...buildReport().projects[0], diagnostics }],
      diagnostics,
    });

  const result = runComparison(
    [
      buildRecord(
        buildRepository(),
        buildScopedReport([
          selectedDiagnostic,
          typescriptDiagnostic,
          environmentDiagnostic,
          unselectedDiagnostic,
        ]),
      ),
    ],
    [
      buildRecord(
        buildRepository(),
        buildScopedReport([selectedDiagnostic, typescriptDiagnostic, environmentDiagnostic]),
      ),
    ],
    ["react-doctor/example"],
  );

  assert.equal(result.status, SUCCESS_EXIT_CODE, result.stderr);
  const comparison = JSON.parse(result.stdout);
  assert.equal(comparison.summary.baselineDiagnostics, 3);
  assert.equal(comparison.summary.candidateDiagnostics, 3);
  assert.equal(comparison.summary.unchanged, 3);
  assert.ok(comparison.invariantRuleScope.includes("TS/*"));
  assert.ok(comparison.invariantRuleScope.includes("react-doctor/require-pnpm-hardening"));
});

test("detects changed always-on diagnostics within a rule scope", () => {
  const baselineInvariantDiagnostic = buildV3Diagnostic({
    id: "src/types.ts::1:1::TS/8011::digest",
    plugin: "TS",
    rule: "8011",
    message: "Baseline parser diagnostic",
  });
  const candidateInvariantDiagnostic = {
    ...baselineInvariantDiagnostic,
    message: "Candidate parser diagnostic",
  };
  const buildScopedReport = (diagnostic) =>
    buildReport({
      projects: [{ ...buildReport().projects[0], diagnostics: [diagnostic] }],
      diagnostics: [diagnostic],
    });

  const result = runComparison(
    [buildRecord(buildRepository(), buildScopedReport(baselineInvariantDiagnostic))],
    [buildRecord(buildRepository(), buildScopedReport(candidateInvariantDiagnostic))],
    ["react-doctor/example"],
  );

  assert.equal(result.status, 1, result.stderr);
  assert.equal(JSON.parse(result.stdout).summary.added, 1);
  assert.equal(JSON.parse(result.stdout).summary.removed, 1);
});

test("rejects candidate diagnostics outside the selected rule scope", () => {
  const selectedDiagnostic = buildV3Diagnostic();
  const unselectedDiagnostic = buildV3Diagnostic({
    id: "src/app.tsx::2:1::react-doctor/unselected::digest",
    line: 2,
    rule: "unselected",
  });
  const baselineRecord = buildRecord();
  const candidateReport = buildReport({
    projects: [
      {
        ...buildReport().projects[0],
        diagnostics: [selectedDiagnostic, unselectedDiagnostic],
      },
    ],
    diagnostics: [selectedDiagnostic, unselectedDiagnostic],
  });

  const result = runComparison(
    [baselineRecord],
    [buildRecord(buildRepository(), candidateReport)],
    ["react-doctor/example"],
  );

  assert.equal(result.status, 2, result.stderr);
  assert.match(JSON.parse(result.stdout).skippedProjects[0].candidateError, /outside rule scope/);
});

test("rejects candidate reports that omit a zero-hit analyzed file", () => {
  const baselineReport = buildReport();
  baselineReport.projects[0].analyzedFiles = ["src/app.tsx", "src/zero-hit.tsx"];
  baselineReport.projects[0].analyzedFileCount = 2;
  baselineReport.projects[0].scannedFileCount = 2;
  const candidateReport = buildReport();
  candidateReport.projects[0].scannedFileCount = 1;

  const result = runComparison(
    [buildRecord(buildRepository(), baselineReport)],
    [buildRecord(buildRepository(), candidateReport)],
    ["react-doctor/example"],
  );

  assert.equal(result.status, 2, result.stderr);
  assert.match(JSON.parse(result.stdout).skippedProjects[0].candidateError, /coverage differs/);
});

test("rejects candidate reports that omit a zero-hit project", () => {
  const diagnosticProject = buildReport().projects[0];
  const zeroHitProject = {
    ...diagnosticProject,
    directory: "/workspace/target/packages/zero-hit",
    packageRoot: "/workspace/target/packages/zero-hit",
    diagnostics: [],
    analyzedFiles: ["src/index.ts"],
  };
  const baselineReport = buildReport({
    projects: [diagnosticProject, zeroHitProject],
    diagnostics: diagnosticProject.diagnostics,
  });
  const candidateReport = buildReport();

  const result = runComparison(
    [buildRecord(buildRepository(), baselineReport)],
    [buildRecord(buildRepository(), candidateReport)],
    ["react-doctor/example"],
  );

  assert.equal(result.status, 2, result.stderr);
  assert.match(JSON.parse(result.stdout).skippedProjects[0].candidateError, /coverage differs/);
});

for (const [name, mutateProject] of [
  ["framework", (project) => (project.framework = "vite")],
  [
    "package root",
    (project) => {
      project.directory = "/workspace/target/packages/app";
      project.packageRoot = "/workspace/target/packages/app";
    },
  ],
]) {
  test(`rejects candidate project ${name} drift`, () => {
    const candidateReport = buildReport();
    mutateProject(candidateReport.projects[0]);
    const result = runComparison(
      [buildRecord()],
      [buildRecord(buildRepository(), candidateReport)],
      ["react-doctor/example"],
    );

    assert.equal(result.status, 2, result.stderr);
    assert.match(JSON.parse(result.stdout).skippedProjects[0].candidateError, /coverage differs/);
  });
}

test("accepts semantically identical coverage in a different file order", () => {
  const baselineReport = buildReport();
  baselineReport.projects[0].analyzedFiles = ["src/app.tsx", "src/other.tsx"];
  baselineReport.projects[0].analyzedFileCount = 2;
  baselineReport.projects[0].scannedFileCount = 2;
  const candidateReport = structuredClone(baselineReport);
  candidateReport.projects[0].analyzedFiles.reverse();

  const result = runComparison(
    [buildRecord(buildRepository(), baselineReport)],
    [buildRecord(buildRepository(), candidateReport)],
  );

  assert.equal(result.status, SUCCESS_EXIT_CODE, result.stderr);
});

for (const [name, mutateDiagnostic] of [
  ["help text", (diagnostic) => (diagnostic.help = "Different help.")],
  ["category", (diagnostic) => (diagnostic.category = "Performance")],
  ["tags", (diagnostic) => (diagnostic.tags = ["performance"])],
  ["title", (diagnostic) => (diagnostic.title = "Different title")],
  ["URL", (diagnostic) => (diagnostic.url = "https://example.com/rule")],
  ["span", (diagnostic) => (diagnostic.length = 4)],
  [
    "related locations",
    (diagnostic) =>
      (diagnostic.relatedLocations = [
        {
          filePath: "src/helper.ts",
          line: 2,
          column: 3,
          message: "Related",
        },
      ]),
  ],
  ["fix group", (diagnostic) => (diagnostic.fixGroupId = "group")],
]) {
  test(`detects a diagnostic ${name} change`, () => {
    const baselineReport = buildReport();
    const candidateReport = structuredClone(baselineReport);
    mutateDiagnostic(candidateReport.projects[0].diagnostics[0]);
    mutateDiagnostic(candidateReport.diagnostics[0]);
    const result = runComparison(
      [buildRecord(buildRepository(), baselineReport)],
      [buildRecord(buildRepository(), candidateReport)],
    );

    assert.equal(result.status, 1, result.stderr);
    const summary = JSON.parse(result.stdout).summary;
    assert.equal(summary.added, 1);
    assert.equal(summary.removed, 1);
    assert.equal(summary.unchanged, 0);
  });
}

test("canonicalizes related-location paths across report roots", () => {
  const repository = buildRepository("workspace", "packages/ui");
  const baselineReport = buildReport();
  baselineReport.projects[0].diagnostics[0].relatedLocations = [
    {
      filePath: "src/helper.ts",
      line: 2,
      column: 3,
      message: "Related",
    },
  ];
  baselineReport.diagnostics[0].relatedLocations =
    baselineReport.projects[0].diagnostics[0].relatedLocations;
  const candidateReport = structuredClone(baselineReport);
  candidateReport.projects[0].diagnostics[0].relatedLocations[0].filePath =
    "/workspace/target/src/helper.ts";
  candidateReport.diagnostics[0].relatedLocations[0].filePath = "/workspace/target/src/helper.ts";

  const result = runComparison(
    [buildRecord(repository, baselineReport)],
    [buildRecord(repository, candidateReport)],
  );

  assert.equal(result.status, SUCCESS_EXIT_CODE, result.stderr);
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

test("rejects malformed optional diagnostic fields", () => {
  const report = buildReport();
  report.projects[0].diagnostics[0].relatedLocations = [
    {
      filePath: "src/helper.ts",
      line: "2",
      column: 3,
      message: "Related",
    },
  ];
  report.diagnostics[0].relatedLocations = report.projects[0].diagnostics[0].relatedLocations;

  const result = runComparison(
    [buildRecord(buildRepository(), report)],
    [buildRecord(buildRepository(), report)],
  );

  assert.equal(result.status, 2, result.stderr);
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

test("rejects legacy reports in scoped parity because coverage is unavailable", () => {
  const legacyReport = buildReport({ schemaVersion: 1 });
  const result = runComparison(
    [buildRecord(buildRepository(), legacyReport)],
    [buildRecord(buildRepository(), legacyReport)],
    ["react-doctor/example"],
  );

  assert.equal(result.status, 2);
  assert.match(result.stdout, /Scoped parity requires v3 project coverage/);
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
