import { defineRule } from "../../utils/define-rule.js";
import { isMemberProperty } from "../../utils/is-member-property.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

export const jsMinMaxLoop = defineRule<Rule>({
  id: "js-min-max-loop",
  framework: "global",
  severity: "warn",
  category: "Performance",
  recommendation:
    "Use `Math.min(...array)` / `Math.max(...array)` instead of sorting just to read the first or last element",
  examples: [
    {
      before: "const min = numbers.sort((a, b) => a - b)[0];",
      after: "const min = Math.min(...numbers);",
    },
  ],
  create: (context: RuleContext) => ({
    MemberExpression(node: EsTreeNodeOfType<"MemberExpression">) {
      if (!node.computed) return;

      const object = node.object;
      if (!isNodeOfType(object, "CallExpression") || !isMemberProperty(object.callee, "sort"))
        return;

      const isFirstElement = isNodeOfType(node.property, "Literal") && node.property.value === 0;
      const isLastElement =
        isNodeOfType(node.property, "BinaryExpression") &&
        node.property.operator === "-" &&
        isNodeOfType(node.property.right, "Literal") &&
        node.property.right.value === 1;

      if (isFirstElement || isLastElement) {
        const targetFunction = isFirstElement ? "min" : "max";
        context.report({
          node,
          message: `array.sort()[${isFirstElement ? "0" : "length-1"}] for min/max — use Math.${targetFunction}(...array) instead (O(n) vs O(n log n))`,
        });
      }
    },
  }),
});
