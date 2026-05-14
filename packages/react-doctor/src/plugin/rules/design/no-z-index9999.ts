import { Z_INDEX_ABSURD_THRESHOLD } from "../../constants.js";
import { defineRule } from "../../utils/define-rule.js";
import { walkAst } from "../../utils/walk-ast.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { getInlineStyleExpression } from "./utils/get-inline-style-expression.js";
import { getStylePropertyKey } from "./utils/get-style-property-key.js";
import { getStylePropertyNumberValue } from "./utils/get-style-property-number-value.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

export const noZIndex9999 = defineRule<Rule>({
  framework: "global",
  severity: "warn",
  category: "Architecture",
  recommendation:
    "Define a z-index scale in your design tokens (e.g. dropdown: 10, modal: 20, toast: 30). Create a new stacking context with `isolation: isolate` instead of escalating values",
  examples: [
    {
      before: "<div style={{ zIndex: 9999, position: 'fixed' }} />",
      after: "<div style={{ zIndex: 30, position: 'fixed', isolation: 'isolate' }} />",
    },
  ],
  create: (context: RuleContext) => ({
    JSXAttribute(node: EsTreeNodeOfType<"JSXAttribute">) {
      const expression = getInlineStyleExpression(node);
      if (!expression) return;

      for (const property of expression.properties ?? []) {
        const key = getStylePropertyKey(property);
        if (key !== "zIndex") continue;

        const zValue = getStylePropertyNumberValue(property);
        if (zValue !== null && Math.abs(zValue) >= Z_INDEX_ABSURD_THRESHOLD) {
          context.report({
            node: property,
            message: `z-index: ${zValue} is arbitrarily high — use a deliberate z-index scale (1–50). Extreme values signal a stacking context problem, not a fix`,
          });
        }
      }
    },
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      if (!isNodeOfType(node.callee, "MemberExpression")) return;
      if (
        !isNodeOfType(node.callee.property, "Identifier") ||
        node.callee.property.name !== "create"
      )
        return;
      if (
        !isNodeOfType(node.callee.object, "Identifier") ||
        node.callee.object.name !== "StyleSheet"
      )
        return;

      const argument = node.arguments?.[0];
      if (!argument || !isNodeOfType(argument, "ObjectExpression")) return;

      walkAst(argument, (child: EsTreeNode) => {
        if (!isNodeOfType(child, "Property")) return;
        const key = getStylePropertyKey(child);
        if (key !== "zIndex") return;

        if (isNodeOfType(child.value, "Literal") && typeof child.value.value === "number") {
          const zValue = child.value.value;
          if (Math.abs(zValue) >= Z_INDEX_ABSURD_THRESHOLD) {
            context.report({
              node: child,
              message: `z-index: ${zValue} is arbitrarily high — use a deliberate z-index scale (1–50). Extreme values signal a stacking context problem, not a fix`,
            });
          }
        }
      });
    },
  }),
});
