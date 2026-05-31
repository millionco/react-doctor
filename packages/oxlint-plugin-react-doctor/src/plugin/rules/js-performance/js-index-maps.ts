import { createLoopAwareVisitors } from "../../utils/create-loop-aware-visitors.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";

// `Array.prototype.find` / `.findIndex` take a callback as the first arg.
// Database / ORM `.find(...)` / `.findOne(...)` calls take a query object
// (`repository.find({ where: ... })`) or no args (`collection.find()`). Same
// for `Map.prototype.get`. When the first argument is an ObjectExpression
// or absent, we're not looking at an Array iteration → skip.
const looksLikeArrayCallbackCall = (node: EsTreeNodeOfType<"CallExpression">): boolean => {
  const first = node.arguments?.[0] as EsTreeNode | undefined;
  if (!first) return false;
  if (
    isNodeOfType(first, "ArrowFunctionExpression") ||
    isNodeOfType(first, "FunctionExpression") ||
    isNodeOfType(first, "Identifier") ||
    isNodeOfType(first, "MemberExpression") ||
    isNodeOfType(first, "CallExpression")
  )
    return true;
  return false;
};

export const jsIndexMaps = defineRule<Rule>({
  id: "js-index-maps",
  title: "array.find() inside a loop",
  tags: ["test-noise"],
  severity: "warn",
  recommendation:
    "Build a `Map` once before the loop instead of calling `array.find(...)` inside it",
  create: (context: RuleContext) =>
    createLoopAwareVisitors({
      CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
        if (
          !isNodeOfType(node.callee, "MemberExpression") ||
          !isNodeOfType(node.callee.property, "Identifier")
        )
          return;
        const methodName = node.callee.property.name;
        if (methodName !== "find" && methodName !== "findIndex") return;
        if (!looksLikeArrayCallbackCall(node)) return;
        context.report({
          node,
          message: `This gets slow as your list grows because array.${methodName}() runs inside a loop, so build a Map once before the loop for instant lookups`,
        });
      },
    }),
});
