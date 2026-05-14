import { defineRule } from "../../utils/define-rule.js";
import { isMemberProperty } from "../../utils/is-member-property.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

export const jsTosortedImmutable = defineRule<Rule>({
  framework: "global",
  severity: "warn",
  category: "Performance",
  recommendation:
    "Use `array.toSorted()` (ES2023) instead of `[...array].sort()` for immutable sorting without the spread allocation",
  examples: [
    {
      before: "const sorted = [...items].sort((a, b) => a.id - b.id);",
      after: "const sorted = items.toSorted((a, b) => a.id - b.id);",
    },
  ],
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      if (!isMemberProperty(node.callee, "sort")) return;

      const receiver = node.callee.object;
      if (
        isNodeOfType(receiver, "ArrayExpression") &&
        receiver.elements?.length === 1 &&
        isNodeOfType(receiver.elements[0], "SpreadElement")
      ) {
        context.report({
          node,
          message: "[...array].sort() — use array.toSorted() for immutable sorting (ES2023)",
        });
      }
    },
  }),
});
