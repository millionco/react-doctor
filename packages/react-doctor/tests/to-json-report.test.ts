import { describe, expect, it } from "vitest";
import { toJsonReport } from "../src/index.js";
import type { DiagnoseResult } from "../src/index.js";

const buildDiagnoseResult = (): DiagnoseResult => ({
  diagnostics: [
    {
      filePath: "/virtual/src/App.tsx",
      plugin: "react",
      rule: "no-danger",
      severity: "warning",
      message: "Avoid dangerouslySetInnerHTML",
      help: "Use safer alternatives",
      line: 7,
      column: 1,
      category: "security",
    },
  ],
  score: { score: 88, label: "Great" },
  project: {
    rootDirectory: "/virtual",
    projectName: "virtual-app",
    reactVersion: "19.0.0",
    framework: "vite",
    hasTypeScript: true,
    hasReactCompiler: false,
    sourceFileCount: 12,
  },
  elapsedMilliseconds: 321,
});

describe("toJsonReport (Node API helper)", () => {
  it("converts a DiagnoseResult into the canonical JSON report shape", () => {
    const result = buildDiagnoseResult();
    const report = toJsonReport(result, { version: "1.2.3" });

    expect(report.schemaVersion).toBe(1);
    expect(report.ok).toBe(true);
    expect(report.version).toBe("1.2.3");
    expect(report.directory).toBe("/virtual");
    expect(report.mode).toBe("full");
    expect(report.projects).toHaveLength(1);
    expect(report.projects[0].project).toBe(result.project);
    expect(report.diagnostics).toEqual(report.projects[0].diagnostics);
    expect(report.summary).toMatchObject({
      errorCount: 0,
      warningCount: 1,
      affectedFileCount: 1,
      totalDiagnosticCount: 1,
      score: 88,
      scoreLabel: "Great",
    });

    const roundTripped = JSON.parse(JSON.stringify(report));
    expect(roundTripped.summary.score).toBe(88);
  });

  it("defaults version when caller omits it", () => {
    const report = toJsonReport(buildDiagnoseResult());
    expect(report.version).toBe("0.0.0");
    expect(report.directory).toBe("/virtual");
  });
});
