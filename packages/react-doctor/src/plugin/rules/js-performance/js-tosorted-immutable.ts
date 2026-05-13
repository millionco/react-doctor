import { defineRule } from "../../utils/define-rule.js";
import { isMemberProperty } from "../../utils/is-member-property.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";

export const jsTosortedImmutable = defineRule<Rule>({
  recommendation:
    "Use `array.toSorted()` (ES2023) instead of `[...array].sort()` for immutable sorting without the spread allocation",
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNode) {
      if (!isMemberProperty(node.callee, "sort")) return;

      const receiver = node.callee.object;
      if (
        receiver?.type === "ArrayExpression" &&
        receiver.elements?.length === 1 &&
        receiver.elements[0]?.type === "SpreadElement"
      ) {
        context.report({
          node,
          message: "[...array].sort() — use array.toSorted() for immutable sorting (ES2023)",
        });
      }
    },
  }),
});
