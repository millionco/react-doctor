import { describe, expect, it } from "vite-plus/test";
import type { Diagnostic } from "@react-doctor/core";
import { summarizeRuleFirings } from "../src/cli/utils/record-scan-metrics.js";

const buildDiagnostic = (overrides: Partial<Diagnostic>): Diagnostic => ({
  filePath: "src/App.tsx",
  plugin: "react-doctor",
  rule: "no-array-index-as-key",
  severity: "warning",
  message: "Array index used as a key",
  help: "Use a stable id",
  line: 1,
  column: 1,
  category: "Correctness",
  ...overrides,
});

describe("summarizeRuleFirings", () => {
  it("aggregates repeats of the same rule + severity into one bucket", () => {
    const firings = summarizeRuleFirings([
      buildDiagnostic({}),
      buildDiagnostic({ filePath: "src/Other.tsx" }),
    ]);
    expect(firings).toHaveLength(1);
    expect(firings[0]).toEqual({
      rule: "react-doctor/no-array-index-as-key",
      plugin: "react-doctor",
      category: "Correctness",
      severity: "warning",
      count: 2,
    });
  });

  it("splits the same rule into separate buckets per severity", () => {
    const firings = summarizeRuleFirings([
      buildDiagnostic({ severity: "warning" }),
      buildDiagnostic({ severity: "error" }),
    ]);
    expect(firings).toHaveLength(2);
    expect(firings.map((firing) => firing.severity).sort()).toEqual(["error", "warning"]);
    expect(firings.every((firing) => firing.count === 1)).toBe(true);
  });

  it("keys distinct rules separately and uses the <plugin>/<rule> identity", () => {
    const firings = summarizeRuleFirings([
      buildDiagnostic({ rule: "no-array-index-as-key" }),
      buildDiagnostic({ plugin: "custom", rule: "no-foo", category: "Performance" }),
    ]);
    expect(firings).toHaveLength(2);
    expect(firings.find((firing) => firing.plugin === "custom")).toEqual({
      rule: "custom/no-foo",
      plugin: "custom",
      category: "Performance",
      severity: "warning",
      count: 1,
    });
  });

  it("returns an empty list when there are no diagnostics", () => {
    expect(summarizeRuleFirings([])).toEqual([]);
  });
});
