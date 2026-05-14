import { TINY_TEXT_THRESHOLD_PX } from "../../constants.js";
import { defineRule } from "../../utils/define-rule.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { getInlineStyleExpression } from "./utils/get-inline-style-expression.js";
import { getStylePropertyStringValue } from "./utils/get-style-property-string-value.js";
import { getStylePropertyKey } from "./utils/get-style-property-key.js";
import { getStylePropertyNumberValue } from "./utils/get-style-property-number-value.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

export const noTinyText = defineRule<Rule>({
  framework: "global",
  severity: "warn",
  category: "Accessibility",
  recommendation:
    "Use at least 12px for body content, 16px is ideal. Small text is hard to read, especially on high-DPI mobile screens",
  examples: [
    {
      before: "<span style={{ fontSize: 9 }}>Body text</span>",
      after: "<span style={{ fontSize: 14 }}>Body text</span>",
    },
  ],
  create: (context: RuleContext) => ({
    JSXAttribute(node: EsTreeNodeOfType<"JSXAttribute">) {
      const expression = getInlineStyleExpression(node);
      if (!expression) return;

      for (const property of expression.properties ?? []) {
        const key = getStylePropertyKey(property);
        if (key !== "fontSize") continue;

        let pxValue: number | null = null;
        const numValue = getStylePropertyNumberValue(property);
        const strValue = getStylePropertyStringValue(property);

        if (numValue !== null) {
          pxValue = numValue;
        } else if (strValue !== null) {
          const pxMatch = strValue.match(/^([\d.]+)px$/);
          if (pxMatch) pxValue = parseFloat(pxMatch[1]);
          const remMatch = strValue.match(/^([\d.]+)rem$/);
          if (remMatch) pxValue = parseFloat(remMatch[1]) * 16;
        }

        if (pxValue !== null && pxValue > 0 && pxValue < TINY_TEXT_THRESHOLD_PX) {
          context.report({
            node: property,
            message: `Font size ${pxValue}px is too small — body text should be at least ${TINY_TEXT_THRESHOLD_PX}px for readability, 16px is ideal`,
          });
        }
      }
    },
  }),
});
