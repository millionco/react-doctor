import { describe, expect, it } from "vitest";
import type { Diagnostic } from "../src/types";
import {
  calculateScoreLocally,
  countUniqueRules,
  getScoreLabel,
  scoreFromRuleCounts,
} from "../src/score";

const sampleDiagnostic = (
  overrides: Partial<Diagnostic> & Pick<Diagnostic, "plugin" | "rule" | "severity">,
): Diagnostic => ({
  filePath: "/x.tsx",
  message: "m",
  help: "h",
  line: 1,
  column: 1,
  category: "Other",
  ...overrides,
});

describe("score helpers", () => {
  it("getScoreLabel matches thresholds", () => {
    expect(getScoreLabel(90)).toBe("Great");
    expect(getScoreLabel(60)).toBe("Needs work");
    expect(getScoreLabel(40)).toBe("Critical");
  });

  it("countUniqueRules dedupes by plugin/rule and severity", () => {
    const diagnostics: Diagnostic[] = [
      sampleDiagnostic({ plugin: "react-doctor", rule: "a", severity: "error" }),
      sampleDiagnostic({ plugin: "react-doctor", rule: "a", severity: "error" }),
      sampleDiagnostic({ plugin: "react-doctor", rule: "b", severity: "warning" }),
    ];
    expect(countUniqueRules(diagnostics)).toEqual({ errorRuleCount: 1, warningRuleCount: 1 });
  });

  it("scoreFromRuleCounts applies penalties", () => {
    expect(scoreFromRuleCounts(0, 0)).toBe(100);
    expect(scoreFromRuleCounts(2, 0)).toBe(Math.round(100 - 2 * 1.5));
  });

  it("calculateScoreLocally returns score and label", () => {
    const result = calculateScoreLocally([
      sampleDiagnostic({ plugin: "p", rule: "r", severity: "error" }),
    ]);
    expect(result.score).toBe(scoreFromRuleCounts(1, 0));
    expect(result.label).toBe(getScoreLabel(result.score));
  });
});
