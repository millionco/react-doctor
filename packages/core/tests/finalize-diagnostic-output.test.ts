import { describe, expect, it } from "vite-plus/test";
import { buildDiagnosticPipeline } from "../src/build-diagnostic-pipeline.js";
import { finalizeDiagnosticOutput } from "../src/finalize-diagnostic-output.js";
import type { Diagnostic, ReactDoctorConfig } from "../src/types/index.js";

const buildDiagnostic = (overrides: Partial<Diagnostic> = {}): Diagnostic => ({
  filePath: "src/component.tsx",
  plugin: "react-doctor",
  rule: "test-rule",
  severity: "warning",
  message: "Test finding",
  help: "Fix the finding.",
  line: 1,
  column: 1,
  category: "Maintainability",
  ...overrides,
});

describe("finalizeDiagnosticOutput", () => {
  it("preserves the complete filtering, ordering, grouping, and scoring projection contract", () => {
    const userConfig: ReactDoctorConfig = {
      rules: {
        "react-doctor/escalated": "error",
        "react-doctor/suppressed": "off",
      },
      surfaces: {
        score: {
          excludeRules: ["react-doctor/score-hidden"],
        },
      },
    };
    const pipeline = buildDiagnosticPipeline({
      rootDirectory: "/repo",
      userConfig,
      readFileLinesSync: () => [],
      respectInlineDisables: true,
      showWarnings: true,
    });
    const environmentDuplicate = buildDiagnostic({
      filePath: "src/d.tsx",
      rule: "duplicate",
      help: "Environment copy",
      line: 4,
      column: 2,
    });
    const lintDuplicate = buildDiagnostic({
      ...environmentDuplicate,
      help: "Lint copy",
    });
    const groupMessage = "State resets after every prop change.";
    const rawDiagnostics = [
      buildDiagnostic({
        filePath: "src/z.tsx",
        rule: "suppressed",
      }),
      buildDiagnostic({
        filePath: "src/b.tsx",
        rule: "escalated",
        line: 10,
        column: 5,
      }),
      buildDiagnostic({
        filePath: "src/a.tsx",
        rule: "score-hidden",
        line: 3,
        column: 9,
      }),
      buildDiagnostic({
        filePath: "src/c.tsx",
        rule: "severity-tie",
        severity: "warning",
        line: 7,
        column: 4,
      }),
      buildDiagnostic({
        filePath: "src/c.tsx",
        rule: "severity-tie",
        severity: "error",
        line: 7,
        column: 4,
      }),
      buildDiagnostic({
        filePath: "src/group.tsx",
        rule: "no-derived-state-effect",
        message: groupMessage,
        line: 20,
      }),
      buildDiagnostic({
        filePath: "src/group.tsx",
        rule: "no-derived-state-effect",
        message: groupMessage,
        line: 10,
      }),
    ];
    const processedDiagnostics = rawDiagnostics.flatMap((diagnostic) => {
      const processedDiagnostic = pipeline.apply(diagnostic);
      return processedDiagnostic === null ? [] : [processedDiagnostic];
    });

    const result = finalizeDiagnosticOutput({
      environmentDiagnostics: [environmentDuplicate],
      securityDiagnostics: [],
      supplyChainDiagnostics: [],
      lintDiagnostics: [...processedDiagnostics, lintDuplicate],
      deadCodeDiagnostics: [],
      scoreSurface: "score",
      userConfig,
    });

    expect(
      result.diagnostics.map((diagnostic) => ({
        filePath: diagnostic.filePath,
        line: diagnostic.line,
        column: diagnostic.column,
        severity: diagnostic.severity,
        rule: diagnostic.rule,
        help: diagnostic.help,
      })),
    ).toEqual([
      {
        filePath: "src/a.tsx",
        line: 3,
        column: 9,
        severity: "warning",
        rule: "score-hidden",
        help: "Fix the finding.",
      },
      {
        filePath: "src/b.tsx",
        line: 10,
        column: 5,
        severity: "error",
        rule: "escalated",
        help: "Fix the finding.",
      },
      {
        filePath: "src/c.tsx",
        line: 7,
        column: 4,
        severity: "error",
        rule: "severity-tie",
        help: "Fix the finding.",
      },
      {
        filePath: "src/c.tsx",
        line: 7,
        column: 4,
        severity: "warning",
        rule: "severity-tie",
        help: "Fix the finding.",
      },
      {
        filePath: "src/d.tsx",
        line: 4,
        column: 2,
        severity: "warning",
        rule: "duplicate",
        help: "Environment copy",
      },
      {
        filePath: "src/d.tsx",
        line: 4,
        column: 2,
        severity: "warning",
        rule: "duplicate",
        help: "Lint copy",
      },
      {
        filePath: "src/group.tsx",
        line: 10,
        column: 1,
        severity: "warning",
        rule: "no-derived-state-effect",
        help: "Fix the finding.",
      },
      {
        filePath: "src/group.tsx",
        line: 20,
        column: 1,
        severity: "warning",
        rule: "no-derived-state-effect",
        help: "Fix the finding.",
      },
    ]);
    expect(result.diagnostics.filter((diagnostic) => diagnostic.rule === "suppressed")).toEqual([]);
    const groupedDiagnostics = result.diagnostics.filter(
      (diagnostic) => diagnostic.rule === "no-derived-state-effect",
    );
    expect(groupedDiagnostics.every((diagnostic) => diagnostic.fixGroupId !== undefined)).toBe(
      true,
    );
    expect(new Set(groupedDiagnostics.map((diagnostic) => diagnostic.fixGroupId)).size).toBe(1);
    expect(result.scoreDiagnostics).toEqual(
      result.diagnostics.filter((diagnostic) => diagnostic.rule !== "score-hidden"),
    );
  });
});
