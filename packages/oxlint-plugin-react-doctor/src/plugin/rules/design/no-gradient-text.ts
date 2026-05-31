import { defineRule } from "../../utils/define-rule.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { getInlineStyleExpression } from "./utils/get-inline-style-expression.js";
import { getStylePropertyStringValue } from "./utils/get-style-property-string-value.js";
import { getStylePropertyKey } from "./utils/get-style-property-key.js";
import { getStringFromClassNameAttr } from "./utils/get-string-from-class-name-attr.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

export const noGradientText = defineRule<Rule>({
  id: "no-gradient-text",
  title: "Gradient text is hard to read",
  tags: ["design", "test-noise"],
  severity: "warn",
  recommendation:
    "Use a solid text color so it stays readable. For emphasis, change the weight, size, or color instead of using a gradient.",
  create: (context: RuleContext) => ({
    JSXAttribute(node: EsTreeNodeOfType<"JSXAttribute">) {
      const expression = getInlineStyleExpression(node);
      if (!expression) return;

      let hasBackgroundClipText = false;
      let hasGradientBackground = false;

      for (const property of expression.properties ?? []) {
        const key = getStylePropertyKey(property);
        const value = getStylePropertyStringValue(property);
        if (!key || !value) continue;

        if ((key === "backgroundClip" || key === "WebkitBackgroundClip") && value === "text") {
          hasBackgroundClipText = true;
        }
        if ((key === "backgroundImage" || key === "background") && value.includes("gradient")) {
          hasGradientBackground = true;
        }
      }

      if (hasBackgroundClipText && hasGradientBackground) {
        context.report({
          node,
          message:
            "Your users struggle to read gradient text (background-clip: text), so use a solid text color instead.",
        });
      }
    },
    JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
      const classStr = getStringFromClassNameAttr(node);
      if (!classStr) return;

      if (/\bbg-clip-text\b/.test(classStr) && /\bbg-gradient-to-/.test(classStr)) {
        context.report({
          node,
          message:
            "Your users struggle to read gradient text (bg-clip-text + bg-gradient), so use a solid text color instead.",
        });
      }
    },
  }),
});
