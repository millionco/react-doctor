import { describe, expect, it } from "vite-plus/test";
import { noArrayIndexAsKey } from "../../oxlint-plugin-react-doctor/src/plugin/rules/correctness/no-array-index-as-key.js";
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

describe("closed render-helper editable ancestor regression", () => {
  it("retains the known editable-parent index-key finding in synthetic corpus replay", () => {
    const result = fuzzRuleWithStats(noArrayIndexAsKey.id, noArrayIndexAsKey, {
      iterations: 0,
      seed: 37,
      slowThresholdMs: 10_000,
      corpus: [
        {
          relativePath: "true-positives/no-array-index-as-key--editable-helper-parent.tsx",
          code: 'import { Fragment, type DetailedHTMLProps, type HTMLAttributes, type ReactNode } from "react";\ndeclare module "react" {\n  namespace JSX {\n    interface IntrinsicElements {\n      "editable-surface": DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement>;\n      "stateful-token": DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement>;\n    }\n  }\n}\nconst choose = (value: string): void => { void value; };\nconst attributes = { contentEditable: true } as const;\nconst EditableSurface = ({ children }: { children: ReactNode }) => <div contentEditable>{children}</div>;\nconst UI = { EditableSurface };\nconst containerRef = (element: HTMLDivElement | null): void => {\n  if (element) element.contentEditable = "true";\n};\ninterface TextProps {\n  text: string;\n  pattern?: RegExp | null;\n}\nexport const HighlightedLabel = (props: TextProps) => {\n  const renderText = () => {\n    const { pattern } = props;\n    if (pattern) {\n      return props.text.split(pattern).map((segment, index) =>\n        segment.match(pattern) ? <b key={index}>{segment}</b> : segment,\n      );\n    }\n    return props.text;\n  };\n  return <div contentEditable>{renderText()}</div>;\n};\n',
          ruleIds: [noArrayIndexAsKey.id],
          verdict: "fail",
        },
      ],
    });
    expect(result.stats.executedProgramCount).toBe(1);
    expect(result.stats.skippedParseErrorCount).toBe(0);
    expect(result.stats.firedProgramCount).toBe(1);
    expect(result.findings).toEqual([]);
  });
});
