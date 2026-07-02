import { describe, expect, it } from "vite-plus/test";
import type { Diagnostic } from "@react-doctor/core";
import {
  summarizeDisabledRules,
  summarizeRuleFirings,
} from "../src/cli/utils/record-scan-metrics.js";

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

describe("summarizeDisabledRules", () => {
  it("lists `rules: off` entries with canonicalized keys and skips warn/error overrides", () => {
    const disabledRules = summarizeDisabledRules({
      rules: {
        "react/jsx-key": "off",
        "no-eval": "off",
        "react-doctor/no-danger": "warn",
      },
    });
    expect(disabledRules).toEqual([
      { rule: "react-doctor/jsx-key", source: "rules" },
      { rule: "react-doctor/no-eval", source: "rules" },
    ]);
  });

  it("lists `ignore.rules` entries, deduping alias spellings of one rule per source", () => {
    const disabledRules = summarizeDisabledRules({
      rules: { "react-doctor/jsx-key": "off" },
      ignore: { rules: ["react/jsx-key", "react-doctor/jsx-key"] },
    });
    expect(disabledRules).toEqual([
      { rule: "react-doctor/jsx-key", source: "rules" },
      { rule: "react-doctor/jsx-key", source: "ignore" },
    ]);
  });

  it("returns an empty list for a null or rule-free config", () => {
    expect(summarizeDisabledRules(null)).toEqual([]);
    expect(summarizeDisabledRules({})).toEqual([]);
  });
});
