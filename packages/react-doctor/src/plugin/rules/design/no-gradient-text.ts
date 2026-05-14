import { defineRule } from "../../utils/define-rule.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { getInlineStyleExpression } from "./utils/get-inline-style-expression.js";
import { getStylePropertyStringValue } from "./utils/get-style-property-string-value.js";
import { getStylePropertyKey } from "./utils/get-style-property-key.js";
import { getStringFromClassNameAttr } from "./utils/get-string-from-class-name-attr.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

export const noGradientText = defineRule<Rule>({
  tags: ["design", "test-noise"],
  framework: "global",
  severity: "warn",
  category: "Architecture",
  recommendation:
    "Use solid text colors for readability. If you need emphasis, use font weight, size, or a distinct color instead of gradients",
  examples: [
    {
      before:
        '<h1 className="bg-clip-text text-transparent bg-gradient-to-r from-blue-500 to-purple-500">Welcome</h1>',
      after: '<h1 className="text-blue-600 font-bold">Welcome</h1>',
    },
  ],
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
            "Gradient text (background-clip: text) is decorative rather than meaningful — a common AI tell. Use solid colors for text",
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
            "Gradient text (bg-clip-text + bg-gradient) is decorative rather than meaningful — a common AI tell. Use solid colors for text",
        });
      }
    },
  }),
});
