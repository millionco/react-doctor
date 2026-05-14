import { createLoopAwareVisitors } from "../../utils/create-loop-aware-visitors.js";
import { defineRule } from "../../utils/define-rule.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

export const jsIndexMaps = defineRule<Rule>({
  framework: "global",
  severity: "warn",
  category: "Performance",
  recommendation:
    "Build an index `Map` once outside the loop instead of `array.find(...)` inside it",
  examples: [
    {
      before: "for (const id of ids) {\n  const user = users.find((u) => u.id === id);\n}",
      after:
        "const usersById = new Map(users.map((u) => [u.id, u]));\nfor (const id of ids) {\n  const user = usersById.get(id);\n}",
    },
  ],
  create: (context: RuleContext) =>
    createLoopAwareVisitors({
      CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
        if (
          !isNodeOfType(node.callee, "MemberExpression") ||
          !isNodeOfType(node.callee.property, "Identifier")
        )
          return;
        const methodName = node.callee.property.name;
        if (methodName === "find" || methodName === "findIndex") {
          context.report({
            node,
            message: `array.${methodName}() in a loop is O(n*m) — build a Map for O(1) lookups`,
          });
        }
      },
    }),
});
