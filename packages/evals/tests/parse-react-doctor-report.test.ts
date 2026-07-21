import { describe, expect, it } from "vite-plus/test";

import { parseReactDoctorReport } from "../src/utils/parse-react-doctor-report.js";

const buildDiagnostic = () => ({
  id: "src/app.tsx::1:1::react-doctor/example::digest",
  normalizedFilePath: "src/app.tsx",
  filePath: "src/app.tsx",
  plugin: "react-doctor",
  rule: "example",
  severity: "warning",
  message: "Example diagnostic",
  help: "Fix the example.",
  category: "Correctness",
  line: 1,
  column: 1,
  tags: [],
});

const buildReport = () => {
  const diagnostic = buildDiagnostic();
  return {
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
  };
};

describe("parseReactDoctorReport", () => {
  it("returns complete successful reports", () => {
    const report = buildReport();

    expect(parseReactDoctorReport(JSON.stringify(report))).toEqual(report);
  });

  it("accepts complete legacy reports", () => {
    const legacyDiagnostic = {
      filePath: "src/app.tsx",
      plugin: "react-doctor",
      rule: "example",
      severity: "warning",
      message: "Example diagnostic",
      help: "Fix the example.",
      category: "Correctness",
      line: 1,
      column: 1,
    };
    const report = {
      ...buildReport(),
      schemaVersion: 1,
      projects: [
        {
          directory: "/workspace/target",
          project: {},
          diagnostics: [legacyDiagnostic],
          score: null,
          skippedChecks: [],
          elapsedMilliseconds: 1,
        },
      ],
      diagnostics: [legacyDiagnostic],
    };

    expect(parseReactDoctorReport(JSON.stringify(report))).toEqual(report);
  });

  it("throws the report error message for unsuccessful reports", () => {
    const report = { ok: false, error: { message: "No React project found" } };

    expect(() => parseReactDoctorReport(JSON.stringify(report))).toThrow("No React project found");
  });

  it("rejects incomplete project reports so evaluation retries them", () => {
    const report = buildReport();
    report.projects[0]!.complete = false;

    expect(() => parseReactDoctorReport(JSON.stringify(report), 1)).toThrow(
      "React Doctor returned an invalid JSON report",
    );
  });

  it("rejects a successful report from a nonzero process", () => {
    const report = buildReport();

    expect(() => parseReactDoctorReport(JSON.stringify(report), 1)).toThrow(
      /React Doctor exited with code 1:[\s\S]*successful JSON report with a nonzero exit code[\s\S]*"ok":true/,
    );
  });

  it("rejects complete-looking output from a terminated process", () => {
    const report = buildReport();

    expect(() => parseReactDoctorReport(JSON.stringify(report), 137)).toThrow(
      /React Doctor exited with code 137:[\s\S]*successful JSON report with a nonzero exit code[\s\S]*"complete":true/,
    );
  });

  it("rejects contradictory completion metadata", () => {
    const baseReport = buildReport();
    const skippedReport = {
      ...baseReport,
      projects: [{ ...baseReport.projects[0], skippedChecks: ["lint"] }],
    };
    const reasonReport = {
      ...baseReport,
      projects: [{ ...baseReport.projects[0], skippedCheckReasons: { lint: "timed out" } }],
    };
    const mismatchedCountReport = {
      ...baseReport,
      projects: [{ ...baseReport.projects[0], scannedFileCount: 2 }],
    };

    expect(() => parseReactDoctorReport(JSON.stringify(skippedReport))).toThrow(
      "React Doctor returned an invalid JSON report",
    );
    expect(() => parseReactDoctorReport(JSON.stringify(reasonReport))).toThrow(
      "React Doctor returned an invalid JSON report",
    );
    expect(() => parseReactDoctorReport(JSON.stringify(mismatchedCountReport))).toThrow(
      "React Doctor returned an invalid JSON report",
    );
  });

  it("rejects missing completion status", () => {
    const report = buildReport();
    const project = { ...report.projects[0] };
    Reflect.deleteProperty(project, "complete");
    const reportWithoutCompletion = { ...report, projects: [project] };

    expect(() => parseReactDoctorReport(JSON.stringify(reportWithoutCompletion))).toThrow(
      "React Doctor returned an invalid JSON report",
    );
  });

  it("rejects malformed diagnostics", () => {
    const report = buildReport();
    const malformedDiagnostic = { ...buildDiagnostic(), line: "1" };
    const malformedReport = {
      ...report,
      diagnostics: [malformedDiagnostic],
      projects: [{ ...report.projects[0], diagnostics: [malformedDiagnostic] }],
    };

    expect(() => parseReactDoctorReport(JSON.stringify(malformedReport))).toThrow(
      "React Doctor returned an invalid JSON report",
    );
  });

  it("rejects missing required report and diagnostic fields", () => {
    const missingDiffReport = buildReport();
    Reflect.deleteProperty(missingDiffReport, "diff");
    const missingHelpReport = buildReport();
    Reflect.deleteProperty(missingHelpReport.diagnostics[0], "help");
    const missingProjectFieldReport = buildReport();
    Reflect.deleteProperty(missingProjectFieldReport.projects[0], "framework");

    expect(() => parseReactDoctorReport(JSON.stringify(missingDiffReport))).toThrow(
      "React Doctor returned an invalid JSON report",
    );
    expect(() => parseReactDoctorReport(JSON.stringify(missingHelpReport))).toThrow(
      "React Doctor returned an invalid JSON report",
    );
    expect(() => parseReactDoctorReport(JSON.stringify(missingProjectFieldReport))).toThrow(
      "React Doctor returned an invalid JSON report",
    );
  });

  it("requires baseline data in v2 reports", () => {
    const legacyReport = {
      ...buildReport(),
      schemaVersion: 2,
      projects: [
        {
          directory: "/workspace/target",
          project: {},
          diagnostics: [],
          score: null,
          skippedChecks: [],
          elapsedMilliseconds: 1,
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
    };

    expect(() => parseReactDoctorReport(JSON.stringify(legacyReport))).toThrow(
      "React Doctor returned an invalid JSON report",
    );
    expect(
      parseReactDoctorReport(
        JSON.stringify({
          ...legacyReport,
          baseline: { baseRef: "base", newCount: 0, fixedCount: 0, baseTotalCount: 0 },
        }),
      ),
    ).toBeDefined();
  });

  it("rejects summary totals that do not match diagnostics", () => {
    const report = buildReport();
    report.summary.totalDiagnosticCount = 0;

    expect(() => parseReactDoctorReport(JSON.stringify(report))).toThrow(
      "React Doctor returned an invalid JSON report",
    );
  });

  it("rejects flattened diagnostics that do not match project diagnostics", () => {
    const report = buildReport();
    report.projects[0]!.diagnostics = [];

    expect(() => parseReactDoctorReport(JSON.stringify(report))).toThrow(
      "React Doctor returned an invalid JSON report",
    );
  });

  it("rejects reports without a success status", () => {
    expect(() => parseReactDoctorReport('{"diagnostics":[]}')).toThrow(
      "React Doctor returned an invalid JSON report",
    );
  });

  it("rejects structurally incomplete successful reports", () => {
    expect(() => parseReactDoctorReport('{"ok":true}')).toThrow(
      "React Doctor returned an invalid JSON report",
    );
  });

  it("preserves the exit code and output from crashed scans", () => {
    expect(() => parseReactDoctorReport("Killed", 137)).toThrow(
      /React Doctor exited with code 137:[\s\S]*Killed/,
    );
  });
});
