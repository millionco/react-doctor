import { SIZE_HEIGHT_AXIS_PATTERN, SIZE_WIDTH_AXIS_PATTERN } from "../../constants/design.js";
import { defineRule } from "../../utils/define-rule.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { getClassNameLiteral } from "./utils/get-class-name-literal.js";
import { collectAxisShorthandPairs } from "./utils/collect-axis-shorthand-pairs.js";
import { hasResponsivePrefix } from "./utils/has-responsive-prefix.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

export const noRedundantSizeAxes = defineRule<Rule>({
  requires: ["tailwind:3.4"],
  tags: ["design", "test-noise"],
  framework: "global",
  severity: "warn",
  category: "Architecture",
  recommendation: "Collapse `w-N h-N` to `size-N` (Tailwind v3.4+) when both axes match",
  examples: [
    {
      before: '<div className="w-8 h-8 rounded-full" />',
      after: '<div className="size-8 rounded-full" />',
    },
  ],
  create: (context: RuleContext) => ({
    JSXAttribute(jsxAttribute: EsTreeNodeOfType<"JSXAttribute">) {
      if (
        !isNodeOfType(jsxAttribute.name, "JSXIdentifier") ||
        jsxAttribute.name.name !== "className"
      ) {
        return;
      }
      const classNameLiteral = getClassNameLiteral(jsxAttribute);
      if (!classNameLiteral) return;
      if (
        hasResponsivePrefix(classNameLiteral, "w") ||
        hasResponsivePrefix(classNameLiteral, "h")
      ) {
        return;
      }
      // Skip percent / fraction widths (`w-1/2 h-1/2`) — those have no `size-*` shorthand.
      const matchedPairs = collectAxisShorthandPairs(
        classNameLiteral,
        SIZE_WIDTH_AXIS_PATTERN,
        SIZE_HEIGHT_AXIS_PATTERN,
      );
      if (matchedPairs.length === 0) return;

      for (const matchedPair of matchedPairs) {
        context.report({
          node: jsxAttribute,
          message: `w-${matchedPair.value} h-${matchedPair.value} → use the shorthand size-${matchedPair.value} (Tailwind v3.4+)`,
        });
      }
    },
  }),
});
