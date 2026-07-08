import { Z_INDEX_ABSURD_THRESHOLD } from "../../constants/design.js";
import { defineRule } from "../../utils/define-rule.js";
import { walkAst } from "../../utils/walk-ast.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { getInlineStyleExpression } from "./utils/get-inline-style-expression.js";
import { getStylePropertyKey } from "./utils/get-style-property-key.js";
import { getStylePropertyNumberValue } from "./utils/get-style-property-number-value.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

export const noZIndex9999 = defineRule({
  id: "no-z-index-9999",
  title: "Excessively high z-index",
  tags: ["test-noise"],
  severity: "warn",
  // Default off: subjective design / house-style preference, not a
  // correctness, performance, or accessibility issue. Opt in to enforce it.
  defaultEnabled: false,
  recommendation:
    "Pick a small z-index scale, like dropdown 10, modal 20, toast 30. To layer something on top, use `isolation: isolate` instead of bigger numbers.",
  create: (context: RuleContext) => {
    // The root cause of absurd z-indexes is a missing layering scale, a
    // single per-file decision — report the first instance, not every
    // overlay/tooltip/toast that repeats it. Negative values (`-9999`)
    // are the deliberate "render behind everything" technique, not the
    // escalation antipattern, so only positive values count.
    let didReportInFile = false;
    return {
      JSXAttribute(node: EsTreeNodeOfType<"JSXAttribute">) {
        if (didReportInFile) return;
        const expression = getInlineStyleExpression(node);
        if (!expression) return;

        for (const property of expression.properties ?? []) {
          const key = getStylePropertyKey(property);
          if (key !== "zIndex") continue;

          const zValue = getStylePropertyNumberValue(property);
          if (zValue !== null && zValue >= Z_INDEX_ABSURD_THRESHOLD) {
            didReportInFile = true;
            context.report({
              node: property,
              message: `z-index ${zValue} is unusually high and can hide a layering bug instead of fixing it. Use a small set scale, like 1 to 50.`,
            });
            return;
          }
        }
      },
      CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
        if (didReportInFile) return;
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
          if (didReportInFile) return;
          if (!isNodeOfType(child, "Property")) return;
          const key = getStylePropertyKey(child);
          if (key !== "zIndex") return;

          if (isNodeOfType(child.value, "Literal") && typeof child.value.value === "number") {
            const zValue = child.value.value;
            if (zValue >= Z_INDEX_ABSURD_THRESHOLD) {
              didReportInFile = true;
              context.report({
                node: child,
                message: `z-index ${zValue} is way too high & usually hides a layering bug instead of fixing it, so use a small set scale, like 1 to 50.`,
              });
            }
          }
        });
      },
    };
  },
});
