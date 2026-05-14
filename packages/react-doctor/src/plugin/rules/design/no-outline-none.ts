import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { getInlineStyleExpression } from "./utils/get-inline-style-expression.js";
import { getStylePropertyStringValue } from "./utils/get-style-property-string-value.js";
import { getStylePropertyKey } from "./utils/get-style-property-key.js";
import { getStylePropertyNumberValue } from "./utils/get-style-property-number-value.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

export const noOutlineNone = defineRule<Rule>({
  framework: "global",
  severity: "warn",
  category: "Accessibility",
  recommendation:
    "Use `:focus-visible { outline: 2px solid var(--color-accent); outline-offset: 2px }` to show focus only for keyboard users while hiding it for mouse clicks",
  examples: [
    {
      before: "<button style={{ outline: 'none' }}>Click me</button>",
      after:
        "<button style={{ outline: 'none', boxShadow: '0 0 0 2px var(--color-accent)' }}>Click me</button>",
    },
  ],
  create: (context: RuleContext) => ({
    JSXAttribute(node: EsTreeNodeOfType<"JSXAttribute">) {
      const expression = getInlineStyleExpression(node);
      if (!expression) return;

      let hasOutlineNone = false;
      let outlineProperty: EsTreeNode | null = null;

      for (const property of expression.properties ?? []) {
        const key = getStylePropertyKey(property);
        if (key !== "outline") continue;

        const strValue = getStylePropertyStringValue(property);
        const numValue = getStylePropertyNumberValue(property);

        if (strValue === "none" || strValue === "0" || numValue === 0) {
          hasOutlineNone = true;
          outlineProperty = property;
        }
      }

      if (!hasOutlineNone || !outlineProperty) return;

      const hasCustomFocusRing = expression.properties?.some((property: EsTreeNode) => {
        const key = getStylePropertyKey(property);
        return key === "boxShadow";
      });

      if (!hasCustomFocusRing) {
        context.report({
          node: outlineProperty,
          message:
            "outline: none removes keyboard focus visibility — use :focus-visible styling instead, or provide a box-shadow focus ring",
        });
      }
    },
  }),
});
