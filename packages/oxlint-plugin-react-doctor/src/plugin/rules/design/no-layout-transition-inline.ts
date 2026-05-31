import { defineRule } from "../../utils/define-rule.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { getInlineStyleExpression } from "./utils/get-inline-style-expression.js";
import { getStylePropertyStringValue } from "./utils/get-style-property-string-value.js";
import { getStylePropertyKey } from "./utils/get-style-property-key.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

export const noLayoutTransitionInline = defineRule<Rule>({
  id: "no-layout-transition-inline",
  title: "Animating layout properties",
  tags: ["test-noise"],
  severity: "warn",
  category: "Performance",
  recommendation:
    "Animate `transform` and `opacity` instead, since they're cheap for the browser. For height, animate `grid-template-rows` from `0fr` to `1fr`.",
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
            message: `Your users see janky, stuttering animation because "${layoutMatch[0]}" relayouts the page every frame, so animate transform & opacity instead.`,
          });
        }
      }
    },
  }),
});
