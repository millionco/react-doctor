import {
  PADDING_HORIZONTAL_AXIS_PATTERN,
  PADDING_VERTICAL_AXIS_PATTERN,
} from "../../constants/design.js";
import { defineRule } from "../../utils/define-rule.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { getClassNameLiteral } from "./utils/get-class-name-literal.js";
import { collectAxisShorthandPairs } from "./utils/collect-axis-shorthand-pairs.js";
import { hasResponsivePrefix } from "./utils/has-responsive-prefix.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

export const noRedundantPaddingAxes = defineRule<Rule>({
  id: "design-no-redundant-padding-axes",
  tags: ["design", "test-noise"],
  severity: "warn",
  category: "Architecture",
  recommendation:
    "Collapse `px-N py-N` to `p-N` when both axes match. Keep them split only when one axis varies at a breakpoint (`py-2 md:py-3`)",
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
      // Per-breakpoint variation is a legit reason to keep the axes split.
      if (
        hasResponsivePrefix(classNameLiteral, "px") ||
        hasResponsivePrefix(classNameLiteral, "py")
      ) {
        return;
      }
      const matchedPairs = collectAxisShorthandPairs(
        classNameLiteral,
        PADDING_HORIZONTAL_AXIS_PATTERN,
        PADDING_VERTICAL_AXIS_PATTERN,
      );
      if (matchedPairs.length === 0) return;

      for (const matchedPair of matchedPairs) {
        context.report({
          node: jsxAttribute,
          message: `px-${matchedPair.value} py-${matchedPair.value} → use the shorthand p-${matchedPair.value}`,
        });
      }
    },
  }),
});
