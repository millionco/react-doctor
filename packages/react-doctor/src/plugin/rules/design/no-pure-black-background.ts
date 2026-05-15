import { defineRule } from "../../utils/define-rule.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { getInlineStyleExpression } from "./utils/get-inline-style-expression.js";
import { getStylePropertyStringValue } from "./utils/get-style-property-string-value.js";
import { getStylePropertyKey } from "./utils/get-style-property-key.js";
import { isPureBlackColor } from "./utils/is-pure-black-color.js";
import { getStringFromClassNameAttr } from "./utils/get-string-from-class-name-attr.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

export const noPureBlackBackground = defineRule<Rule>({
  id: "no-pure-black-background",
  tags: ["design", "test-noise"],
  severity: "warn",
  recommendation:
    "Tint the background slightly toward your brand hue — e.g. `#0a0a0f` or Tailwind's `bg-gray-950`. Pure black looks harsh on modern displays",
  create: (context: RuleContext) => ({
    JSXAttribute(node: EsTreeNodeOfType<"JSXAttribute">) {
      const expression = getInlineStyleExpression(node);
      if (!expression) return;

      for (const property of expression.properties ?? []) {
        const key = getStylePropertyKey(property);
        if (key !== "backgroundColor" && key !== "background") continue;

        const value = getStylePropertyStringValue(property);
        if (value && isPureBlackColor(value)) {
          context.report({
            node: property,
            message:
              "Pure #000 background looks harsh — tint slightly toward your brand hue for a more refined feel (e.g. #0a0a0f)",
          });
        }
      }
    },
    JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
      const classStr = getStringFromClassNameAttr(node);
      if (!classStr) return;

      if (/\bbg-black\b(?!\/)/.test(classStr)) {
        context.report({
          node,
          message:
            "Pure black background (bg-black) looks harsh — use a near-black tinted toward your brand hue (e.g. bg-gray-950)",
        });
      }
    },
  }),
});
