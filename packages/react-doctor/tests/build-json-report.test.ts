import { describe, expect, it } from "vite-plus/test";
import { buildJsonReport, buildJsonReportError } from "@react-doctor/core";
import type { Diagnostic, InspectResult, ProjectInfo } from "@react-doctor/types";

const SAMPLE_PROJECT: ProjectInfo = {
  rootDirectory: "/repo",
  projectName: "sample-app",
  reactVersion: "19.0.0",
  reactMajorVersion: 19,
  tailwindVersion: null,
  framework: "vite",
  hasTypeScript: true,
  hasReactCompiler: false,
  hasTanStackQuery: false,
  hasReactNativeWorkspace: false,
  sourceFileCount: 42,
};

const buildSampleDiagnostic = (overrides: Partial<Diagnostic> = {}): Diagnostic => ({
  filePath: "/repo/src/App.tsx",
  plugin: "react",
  rule: "no-danger",
  severity: "warning",
  message: "Avoid dangerouslySetInnerHTML",
  help: "Use safer alternatives",
  line: 10,
  column: 1,
  category: "security",
  ...overrides,
});

const buildSampleScan = (
  diagnostics: Diagnostic[] = [],
  score = 82,
  label = "Good",
): InspectResult => ({
  diagnostics,
  score: { score, label },
  skippedChecks: [],
  project: SAMPLE_PROJECT,
  elapsedMilliseconds: 1234,
});

describe("buildJsonReport", () => {
  it("produces a JSON-serializable structured report with summary counts", () => {
    const diagnostics = [
      buildSampleDiagnostic({ severity: "error", filePath: "/repo/src/A.tsx" }),
      buildSampleDiagnostic({ severity: "warning", filePath: "/repo/src/A.tsx" }),
      buildSampleDiagnostic({ severity: "warning", filePath: "/repo/src/B.tsx" }),
    ];

    const report = buildJsonReport({
      version: "1.2.3",
      directory: "/repo",
      mode: "full",
      diff: null,
      scans: [{ directory: "/repo", result: buildSampleScan(diagnostics) }],
      totalElapsedMilliseconds: 5000,
    });

    expect(report.schemaVersion).toBe(1);
    expect(report.ok).toBe(true);
    expect(report.version).toBe("1.2.3");
    expect(report.mode).toBe("full");
    expect(report.diff).toBeNull();
    expect(report.diagnostics).toHaveLength(3);
    expect(report.projects).toHaveLength(1);
    expect(report.summary).toEqual({
      errorCount: 1,
      warningCount: 2,
      affectedFileCount: 2,
      totalDiagnosticCount: 3,
      score: 82,
      scoreLabel: "Good",
    });

    expect(() => JSON.parse(JSON.stringify(report))).not.toThrow();
  });

  it("flattens diagnostics across workspace projects and picks the worst score", () => {
    const projectADiagnostics = [buildSampleDiagnostic({ filePath: "/repo/a/X.tsx" })];
    const projectBDiagnostics = [
      buildSampleDiagnostic({ filePath: "/repo/b/Y.tsx", severity: "error" }),
    ];

    const report = buildJsonReport({
      version: "0.0.1",
      directory: "/repo",
      mode: "full",
      diff: null,
      scans: [
        { directory: "/repo/a", result: buildSampleScan(projectADiagnostics, 90, "Great") },
        { directory: "/repo/b", result: buildSampleScan(projectBDiagnostics, 50, "Needs work") },
      ],
      totalElapsedMilliseconds: 10_000,
    });

    expect(report.projects).toHaveLength(2);
    expect(report.diagnostics).toHaveLength(2);
    expect(report.summary.score).toBe(50);
    expect(report.summary.scoreLabel).toBe("Needs work");
    expect(report.summary.errorCount).toBe(1);
    expect(report.summary.warningCount).toBe(1);
  });

  it("returns null score in summary when no project produced a score", () => {
    const report = buildJsonReport({
      version: "0.0.1",
      directory: "/repo",
      mode: "diff",
      diff: {
        baseBranch: "main",
        currentBranch: "feature",
        changedFiles: ["src/foo.tsx", "src/bar.tsx"],
      },
      scans: [
        {
          directory: "/repo",
          result: { ...buildSampleScan([]), score: null },
        },
      ],
      totalElapsedMilliseconds: 100,
    });

    expect(report.summary.score).toBeNull();
    expect(report.summary.scoreLabel).toBeNull();
    expect(report.diff).toEqual({
      baseBranch: "main",
      currentBranch: "feature",
      changedFileCount: 2,
      isCurrentChanges: false,
    });
  });
});

describe("buildJsonReportError", () => {
  it("captures error name and message in a JSON-serializable shape", () => {
    const report = buildJsonReportError({
      version: "1.0.0",
      directory: "/repo",
      error: new TypeError("boom"),
      elapsedMilliseconds: 50,
    });

    expect(report.ok).toBe(false);
    expect(report.error).toEqual({ message: "boom", name: "TypeError", chain: ["boom"] });
    expect(report.diagnostics).toEqual([]);
    expect(report.projects).toEqual([]);
    expect(report.summary.totalDiagnosticCount).toBe(0);
  });

  it("stringifies non-Error throwables", () => {
    const report = buildJsonReportError({
      version: "1.0.0",
      directory: "/repo",
      error: "raw failure",
      elapsedMilliseconds: 50,
    });
    expect(report.error).toEqual({
      message: "raw failure",
      name: "Error",
      chain: ["raw failure"],
    });
  });

  it("preserves the cause chain of nested errors", () => {
    const root = new Error("root cause");
    const middle = new Error("middle layer", { cause: root });
    const top = new Error("top error", { cause: middle });
    const report = buildJsonReportError({
      version: "1.0.0",
      directory: "/repo",
      error: top,
      elapsedMilliseconds: 1,
    });
    expect(report.error?.chain).toEqual(["top error", "middle layer", "root cause"]);
  });
});

describe("buildJsonReport: skippedCheckReasons surface (eval-driven)", () => {
  // HACK: in JSON mode the CLI silences logger output entirely
  // (`setLoggerSilent(true)`), so the only signal that lint was
  // skipped used to be `skippedChecks: ["lint"]` with no explanation.
  // Eval against supabase/studio caught this: a 5-min oxlint hang on
  // a real repo produced an empty stderr and an undocumented
  // skippedChecks entry, leaving CI consumers unable to distinguish
  // a hang from a config error. The optional `skippedCheckReasons`
  // map now carries the human-readable why for each skipped check.
  it("includes skippedCheckReasons on the JSON project entry when present on the scan result", () => {
    const scan: InspectResult = {
      diagnostics: [],
      score: null,
      skippedChecks: ["lint"],
      skippedCheckReasons: {
        lint: "oxlint did not return within 300s — please report",
      },
      project: SAMPLE_PROJECT,
      elapsedMilliseconds: 300_000,
    };
    const report = buildJsonReport({
      version: "1.0.0",
      directory: "/repo",
      mode: "full",
      diff: null,
      scans: [{ directory: "/repo", result: scan }],
      totalElapsedMilliseconds: 300_000,
    });
    expect(report.projects[0].skippedChecks).toEqual(["lint"]);
    expect(report.projects[0].skippedCheckReasons).toEqual({
      lint: "oxlint did not return within 300s — please report",
    });
  });

  it("omits skippedCheckReasons when the scan result has no reasons (backward compatibility)", () => {
    const scan: InspectResult = {
      diagnostics: [],
      score: null,
      skippedChecks: [],
      project: SAMPLE_PROJECT,
      elapsedMilliseconds: 1000,
    };
    const report = buildJsonReport({
      version: "1.0.0",
      directory: "/repo",
      mode: "full",
      diff: null,
      scans: [{ directory: "/repo", result: scan }],
      totalElapsedMilliseconds: 1000,
    });
    expect(report.projects[0]).not.toHaveProperty("skippedCheckReasons");
  });

  // HACK: regression for the eval-driven supabase/studio fix. Previously a
  // single pathological batch hitting the oxlint spawn timeout killed the
  // entire lint scan and left `skippedChecks: ["lint"]` + zero diagnostics.
  // Now per-batch timeouts are soft-failures: lint as a whole still
  // "succeeded" (we got diagnostics from every other batch), but the
  // `lint:partial` reason surfaces WHICH files were dropped.
  it("preserves partial-failure reasons (lint:partial) so consumers see which files were dropped", () => {
    const scan: InspectResult = {
      diagnostics: [buildSampleDiagnostic()],
      score: { score: 75, label: "Good" },
      skippedChecks: [],
      skippedCheckReasons: {
        "lint:partial":
          "100 file(s) exceeded the 60s per-batch oxlint budget and were skipped (pages/foo.tsx, +99 more)",
      },
      project: SAMPLE_PROJECT,
      elapsedMilliseconds: 68000,
    };
    const report = buildJsonReport({
      version: "1.0.0",
      directory: "/repo",
      mode: "full",
      diff: null,
      scans: [{ directory: "/repo", result: scan }],
      totalElapsedMilliseconds: 68000,
    });
    expect(report.projects[0].skippedChecks).toEqual([]);
    expect(report.projects[0].skippedCheckReasons?.["lint:partial"]).toContain(
      "exceeded the 60s per-batch oxlint budget",
    );
    // Diagnostics from successful batches are still present.
    expect(report.projects[0].diagnostics.length).toBeGreaterThan(0);
  });
});
