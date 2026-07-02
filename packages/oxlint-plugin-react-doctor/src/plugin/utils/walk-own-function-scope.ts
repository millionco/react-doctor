import type { EsTreeNode } from "./es-tree-node.js";
import { isFunctionLike } from "./is-function-like.js";
import { walkAst } from "./walk-ast.js";

// Walks a function's own body, never descending into nested functions — so the
// visited nodes (awaits, returns, setter calls, floating chains) belong to THIS
// scope and not a deeper closure. The visitor may return `false` to prune its
// own subtree, exactly like `walkAst`. Any function-like node is a boundary,
// including a function-valued expression body (`() => () => {…}`), whose inner
// closure is a separate scope and is never entered.
export const walkOwnFunctionScope = (
  functionNode: EsTreeNode,
  visitor: (child: EsTreeNode) => boolean | void,
): void => {
  if (!isFunctionLike(functionNode)) return;
  const body = functionNode.body;
  if (!body) return;
  walkAst(body, (child: EsTreeNode) => {
    if (isFunctionLike(child)) return false;
    return visitor(child);
  });
};
