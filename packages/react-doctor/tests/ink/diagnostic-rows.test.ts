import { describe, expect, it } from "vite-plus/test";
import type { Diagnostic } from "@react-doctor/core";
import { buildDiagnosticRows } from "../../src/cli/ink/lib/diagnostic-rows.js";

const makeDiagnostic = (overrides: Partial<Diagnostic>): Diagnostic => ({
  filePath: "src/App.tsx",
  plugin: "react-doctor",
  rule: "rule",
  severity: "warning",
  message: "",
  help: "",
  line: 1,
  column: 1,
  category: "Bugs",
  ...overrides,
});

describe("buildDiagnosticRows", () => {
  it("preserves score priority across categories and severities", () => {
    const rows = buildDiagnosticRows(
      [
        makeDiagnostic({ rule: "warning-low", category: "Bugs" }),
        makeDiagnostic({ rule: "error", category: "Security", severity: "error" }),
        makeDiagnostic({ rule: "warning-high", category: "Maintainability" }),
      ],
      [
        {
          score: 50,
          label: "Critical",
          rules: {
            "react-doctor/warning-low": { priority: 10, tier: "P3" },
            "react-doctor/warning-high": { priority: 90, tier: "P0" },
            "react-doctor/error": { priority: 50, tier: "P1" },
          },
        },
      ],
    );

    expect(rows.map((row) => row.ruleKey)).toEqual([
      "react-doctor/warning-high",
      "react-doctor/error",
      "react-doctor/warning-low",
    ]);
  });
});
