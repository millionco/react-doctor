import type { EsTreeNode } from "./es-tree-node.js";
import { isFunctionLike } from "./is-function-like.js";
import { walkAst } from "./walk-ast.js";

// HACK: variant of `walkAst` that descends through control-flow blocks
// (IfStatement / TryStatement / SwitchCase / loops / labels) but stops
// at any nested function boundary. Used by rules that ask "what runs
// SYNCHRONOUSLY inside this effect's body?" - counts the
// `if (cond) setX(...)` write but ignores the deferred
// `setTimeout(() => setX(...))` one.
//
// Unlike `walkAst`, this one does not support pruning via `false`
// return - descent is always complete except at function boundaries.
export const walkInsideStatementBlocks = (
  node: EsTreeNode,
  visitor: (child: EsTreeNode) => void,
): void => {
  walkAst(node, (child) => {
    if (isFunctionLike(child)) return false;
    visitor(child);
  });
};
