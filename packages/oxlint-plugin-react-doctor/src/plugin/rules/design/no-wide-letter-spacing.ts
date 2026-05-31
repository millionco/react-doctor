import { WIDE_TRACKING_THRESHOLD_EM } from "../../constants/design.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { getInlineStyleExpression } from "./utils/get-inline-style-expression.js";
import { getStylePropertyStringValue } from "./utils/get-style-property-string-value.js";
import { getStylePropertyKey } from "./utils/get-style-property-key.js";
import { getStylePropertyNumberValue } from "./utils/get-style-property-number-value.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

export const noWideLetterSpacing = defineRule<Rule>({
  id: "no-wide-letter-spacing",
  title: "Wide letter spacing on body text",
  severity: "warn",
  tags: ["test-noise"],
  recommendation:
    "Save wide letter-spacing (over 0.05em) for short uppercase labels, nav items, and buttons, not body text.",
  create: (context: RuleContext) => ({
    JSXAttribute(node: EsTreeNodeOfType<"JSXAttribute">) {
      const expression = getInlineStyleExpression(node);
      if (!expression) return;

      let isUppercase = false;
      let letterSpacingProperty: EsTreeNode | null = null;
      let letterSpacingEm: number | null = null;

      for (const property of expression.properties ?? []) {
        const key = getStylePropertyKey(property);
        if (!key) continue;

        if (key === "textTransform") {
          const value = getStylePropertyStringValue(property);
          if (value === "uppercase") isUppercase = true;
        }

        if (key === "letterSpacing") {
          letterSpacingProperty = property;
          const strValue = getStylePropertyStringValue(property);
          const numValue = getStylePropertyNumberValue(property);
          if (strValue) {
            const emMatch = strValue.match(/^([\d.]+)em$/);
            if (emMatch) letterSpacingEm = parseFloat(emMatch[1]);
            const pxMatch = strValue.match(/^([\d.]+)px$/);
            if (pxMatch) letterSpacingEm = parseFloat(pxMatch[1]) / 16;
          }
          if (numValue !== null && numValue > 0) {
            letterSpacingEm = numValue / 16;
          }
        }
      }

      if (
        !isUppercase &&
        letterSpacingProperty &&
        letterSpacingEm !== null &&
        letterSpacingEm > WIDE_TRACKING_THRESHOLD_EM
      ) {
        context.report({
          node: letterSpacingProperty,
          message: `Your users find body text harder to read at ${letterSpacingEm.toFixed(2)}em letter spacing, so save wide spacing for short uppercase labels.`,
        });
      }
    },
  }),
});
