import { describe, expect, it } from "vite-plus/test";
import { buildJsonReport } from "@react-doctor/core";
import type { Diagnostic, InspectResult, ProjectInfo } from "@react-doctor/core";

const projectInfo: ProjectInfo = {
  rootDirectory: "/repo",
  projectName: "app",
  reactVersion: "18.3.1",
  reactMajorVersion: 18,
  tailwindVersion: null,
  zodVersion: null,
  zodMajorVersion: null,
  framework: "nextjs",
  hasTypeScript: true,
  hasReactCompiler: false,
  hasTanStackQuery: false,
  preactVersion: null,
  preactMajorVersion: null,
  nextjsVersion: null,
  nextjsMajorVersion: null,
  hasReactNativeWorkspace: false,
  expoVersion: null,
  hasReanimated: false,
  isPreES2023Target: false,
  sourceFileCount: 50,
};

const errorDiagnostic: Diagnostic = {
  filePath: "src/App.tsx",
  plugin: "react-doctor",
  rule: "no-array-index-as-key",
  severity: "error",
  message: "Array index used as React key",
  help: "",
  line: 12,
  column: 1,
  category: "Correctness",
};

const result = (overrides: Partial<InspectResult> = {}): InspectResult => ({
  diagnostics: [errorDiagnostic],
  score: { score: 88, label: "Good" },
  skippedChecks: [],
  project: projectInfo,
  elapsedMilliseconds: 1000,
  ...overrides,
});

describe("buildJsonReport", () => {
  it("emits a v1 report without baseline info", () => {
    const report = buildJsonReport({
      version: "1.2.3",
      directory: "/repo",
      mode: "diff",
      diff: null,
      scans: [{ directory: "/repo", result: result() }],
      totalElapsedMilliseconds: 1200,
    });
    expect(report.schemaVersion).toBe(1);
    expect(report.mode).toBe("diff");
    expect("baseline" in report).toBe(false);
  });

  it("emits a v2 baseline report carrying the new/fixed delta and head score", () => {
    const report = buildJsonReport({
      version: "1.2.3",
      directory: "/repo",
      mode: "diff",
      diff: null,
      scans: [{ directory: "/repo", result: result() }],
      totalElapsedMilliseconds: 1200,
      baseline: { baseRef: "abc1234def", fixedCount: 3, baseTotalCount: 5 },
    });
    expect(report.schemaVersion).toBe(2);
    expect(report.mode).toBe("baseline");
    if (report.schemaVersion !== 2) throw new Error("expected a v2 report");
    expect(report.baseline.baseRef).toBe("abc1234def");
    expect(report.baseline.newCount).toBe(1); // one introduced finding
    expect(report.baseline.fixedCount).toBe(3);
    expect(report.baseline.baseTotalCount).toBe(5);
    // Score stays the head project-health number; counts reflect introduced only.
    expect(report.summary.score).toBe(88);
    expect(report.summary.totalDiagnosticCount).toBe(1);
    expect(report.summary.errorCount).toBe(1);
  });
});
