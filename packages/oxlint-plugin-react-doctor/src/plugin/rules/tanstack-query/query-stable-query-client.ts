import { UPPERCASE_PATTERN } from "../../constants/react.js";
import { TANSTACK_QUERY_CLIENT_CLASS } from "../../constants/tanstack.js";
import { defineRule } from "../../utils/define-rule.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

// A render function whose body runs on every render: a component (uppercase
// name via declaration / variable / assignment). A nested closure inside it —
// an event handler (`const onClick = () => …`) or a `useState(() => …)`
// initializer — runs LATER / once, not per render, so a `new QueryClient()`
// there is stable and must not be flagged.
const isComponentFunction = (functionNode: EsTreeNode): boolean => {
  if (isNodeOfType(functionNode, "FunctionDeclaration")) {
    return Boolean(functionNode.id?.name && UPPERCASE_PATTERN.test(functionNode.id.name));
  }
  const parent = functionNode.parent;
  if (isNodeOfType(parent, "VariableDeclarator") && isNodeOfType(parent.id, "Identifier")) {
    return UPPERCASE_PATTERN.test(parent.id.name);
  }
  if (isNodeOfType(parent, "AssignmentExpression") && isNodeOfType(parent.left, "Identifier")) {
    return UPPERCASE_PATTERN.test(parent.left.name);
  }
  return false;
};

export const queryStableQueryClient = defineRule({
  id: "query-stable-query-client",
  title: "Unstable QueryClient in component",
  tags: ["test-noise"],
  requires: ["tanstack-query"],
  severity: "warn",
  recommendation:
    "Move `new QueryClient()` to module scope, or wrap it in `useState(() => new QueryClient())`. Recreating it each render wipes the cache.",
  create: (context: RuleContext) => ({
    NewExpression(node: EsTreeNodeOfType<"NewExpression">) {
      if (
        !isNodeOfType(node.callee, "Identifier") ||
        node.callee.name !== TANSTACK_QUERY_CLIENT_CLASS
      )
        return;

      // Only fire when the nearest enclosing function is the component itself
      // — i.e. the construction runs in the render body. A nested closure
      // (event handler, stable-hook initializer) defers it, so it's stable.
      let cursor: EsTreeNode | null | undefined = node.parent;
      while (cursor) {
        if (isFunctionLike(cursor)) {
          if (!isComponentFunction(cursor)) return;
          context.report({
            node,
            message: "new QueryClient() inside a component wipes your cache on every render.",
          });
          return;
        }
        cursor = cursor.parent ?? null;
      }
    },
  }),
});
