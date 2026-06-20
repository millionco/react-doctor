import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { isNodeOfType } from "./is-node-of-type.js";

// Type-guard for the three "function-like" ESTree node shapes:
// `ArrowFunctionExpression`, `FunctionExpression`, `FunctionDeclaration`.
// Accepts `null | undefined` so callers walking parent chains don't need
// their own pre-check. A function boundary is where the CFG stops
// descending — every function gets its own graph.
export const isFunctionLike = (
  node: EsTreeNode | null | undefined,
): node is
  | EsTreeNodeOfType<"ArrowFunctionExpression">
  | EsTreeNodeOfType<"FunctionExpression">
  | EsTreeNodeOfType<"FunctionDeclaration"> =>
  Boolean(
    node &&
    (isNodeOfType(node, "ArrowFunctionExpression") ||
      isNodeOfType(node, "FunctionExpression") ||
      isNodeOfType(node, "FunctionDeclaration")),
  );
