import { describe, expect, it } from "vite-plus/test";
import { buildJsonReport } from "../src/utils/build-json-report.js";
import { buildJsonReportError } from "../src/utils/build-json-report-error.js";
import type { Diagnostic, ProjectInfo, ScanResult } from "../src/types.js";

const SAMPLE_PROJECT: ProjectInfo = {
  rootDirectory: "/repo",
  projectName: "sample-app",
  reactVersion: "19.0.0",
  framework: "vite",
  hasTypeScript: true,
  hasReactCompiler: false,
  hasTanStackQuery: false,
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
): ScanResult => ({
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
