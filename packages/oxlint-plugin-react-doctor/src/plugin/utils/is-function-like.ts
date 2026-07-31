import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";

/**
 * Type-guard for the three "function-like" ESTree node shapes:
 * `ArrowFunctionExpression`, `FunctionExpression`,
 * `FunctionDeclaration`. Accepts `null | undefined` so callers
 * walking parent chains don't need their own pre-check.
 *
 * Was duplicated across five sites as both a plain boolean check
 * (`FUNCTION_LIKE_TYPES.has(node.type)`) and as a type-guard. The
 * type-guard form covers both shapes without callers paying a cast.
 */
export const isFunctionLike = (
  node: EsTreeNode | null | undefined,
): node is
  | EsTreeNodeOfType<"ArrowFunctionExpression">
  | EsTreeNodeOfType<"FunctionExpression">
  | EsTreeNodeOfType<"FunctionDeclaration"> =>
  node !== null &&
  node !== undefined &&
  (node.type === "ArrowFunctionExpression" ||
    node.type === "FunctionExpression" ||
    node.type === "FunctionDeclaration");
