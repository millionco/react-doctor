import { describe, expect, it } from "vite-plus/test";
import { defineRule } from "../../oxlint-plugin-react-doctor/src/plugin/utils/define-rule.js";
import { isNodeOfType } from "../../oxlint-plugin-react-doctor/src/plugin/utils/is-node-of-type.js";
import { fuzzRuleWithStats } from "../src/fuzz-rule.js";

const livenessRule = defineRule({
  id: "liveness-rule",
  title: "Liveness rule",
  severity: "warn",
  recommendation: "Use the positive liveness marker.",
  create: (context) => ({
    Identifier(node) {
      if (isNodeOfType(node, "Identifier") && node.name === "positiveLivenessMarker") {
        context.report({ node, message: "Positive liveness marker found" });
      }
    },
  }),
});

describe("fuzzRuleWithStats", () => {
  it("selects liveness programs only from the targets directory", () => {
    const result = fuzzRuleWithStats(livenessRule.id, livenessRule, {
      iterations: 1,
      corpus: [
        {
          relativePath: "regressions/liveness-rule--valid.tsx",
          code: "const regressionSeed = true;",
        },
        {
          relativePath: "targets/liveness-rule--positive.tsx",
          code: "const positiveLivenessMarker = true;",
        },
      ],
    });

    expect(result.stats.executedProgramCount).toBeGreaterThan(0);
    expect(result.stats.firedProgramCount).toBeGreaterThan(0);
  });

  it("replays declared corpus verdicts deterministically", () => {
    const result = fuzzRuleWithStats(livenessRule.id, livenessRule, {
      iterations: 0,
      corpus: [
        {
          relativePath: "regressions/liveness-rule--unexpected-fire.tsx",
          code: "const positiveLivenessMarker = true;",
          ruleIds: [livenessRule.id],
          verdict: "pass",
        },
        {
          relativePath: "true-positives/liveness-rule--unexpected-silence.tsx",
          code: "const negativeMarker = true;",
          ruleIds: [livenessRule.id],
          verdict: "fail",
        },
      ],
    });

    expect(result.stats.executedProgramCount).toBe(2);
    expect(result.findings.map((finding) => finding.kind)).toEqual([
      "verdict-mismatch",
      "verdict-mismatch",
    ]);
  });
});
