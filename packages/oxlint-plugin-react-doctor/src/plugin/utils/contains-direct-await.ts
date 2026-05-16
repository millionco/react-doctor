import type { EsTreeNode } from "./es-tree-node.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { walkAst } from "./walk-ast.js";

// Returns true if `node` contains an `AwaitExpression` evaluated by the
// enclosing async function — i.e. not inside a nested function (whose
// `await` belongs to that function's own async context).
export const containsDirectAwait = (node: EsTreeNode | null | undefined): boolean => {
  if (!node) return false;
  let foundAwait = false;
  walkAst(node, (child: EsTreeNode) => {
    if (foundAwait) return false;
    if (
      isNodeOfType(child, "FunctionDeclaration") ||
      isNodeOfType(child, "FunctionExpression") ||
      isNodeOfType(child, "ArrowFunctionExpression")
    ) {
      return false;
    }
    if (isNodeOfType(child, "AwaitExpression")) {
      foundAwait = true;
      return false;
    }
  });
  return foundAwait;
};
