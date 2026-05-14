import { defineRule } from "../../utils/define-rule.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { getInlineStyleExpression } from "./utils/get-inline-style-expression.js";
import { getStylePropertyStringValue } from "./utils/get-style-property-string-value.js";
import { getStylePropertyKey } from "./utils/get-style-property-key.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

export const noLayoutTransitionInline = defineRule<Rule>({
  framework: "global",
  severity: "warn",
  category: "Performance",
  recommendation:
    "Use `transform` and `opacity` for transitions — they run on the compositor thread. For height animations, use `grid-template-rows: 0fr → 1fr`",
  examples: [
    {
      before: "<div style={{ transition: 'width 300ms ease' }} />",
      after: "<div style={{ transition: 'transform 300ms ease' }} />",
    },
  ],
  create: (context: RuleContext) => ({
    JSXAttribute(node: EsTreeNodeOfType<"JSXAttribute">) {
      const expression = getInlineStyleExpression(node);
      if (!expression) return;

      for (const property of expression.properties ?? []) {
        const key = getStylePropertyKey(property);
        if (key !== "transition" && key !== "transitionProperty") continue;

        const value = getStylePropertyStringValue(property);
        if (!value) continue;

        const lower = value.toLowerCase();
        if (/\ball\b/.test(lower)) continue;

        const layoutMatch = lower.match(
          /\b(?:(?:max|min)-)?(?:width|height)\b|\bpadding(?:-(?:top|right|bottom|left))?\b|\bmargin(?:-(?:top|right|bottom|left))?\b/,
        );
        if (layoutMatch) {
          context.report({
            node: property,
            message: `Transitioning layout property "${layoutMatch[0]}" causes layout thrash every frame — use transform and opacity instead`,
          });
        }
      }
    },
  }),
});
