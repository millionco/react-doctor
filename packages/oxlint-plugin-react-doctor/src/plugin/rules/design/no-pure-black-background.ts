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
  title: "Pure black background",
  tags: ["design", "test-noise"],
  severity: "warn",
  recommendation:
    "Nudge the background slightly toward your brand color, like `#0a0a0f` or Tailwind's `bg-gray-950`. Pure black looks harsh on modern screens.",
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
              "Your users see a harsh pure #000 background, so nudge it toward your brand color, like #0a0a0f.",
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
            "Your users see a harsh pure black background (bg-black), so use a near-black with a hint of your brand color, like bg-gray-950.",
        });
      }
    },
  }),
});
