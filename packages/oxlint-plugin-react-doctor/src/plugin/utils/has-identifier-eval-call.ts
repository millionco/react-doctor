import type { EsTreeNode } from "./es-tree-node.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { stripParenExpression } from "./strip-paren-expression.js";
import { walkAst } from "./walk-ast.js";

const identifierEvalByRoot = new WeakMap<EsTreeNode, boolean>();

export const hasIdentifierEvalCall = (root: EsTreeNode): boolean => {
  const cached = identifierEvalByRoot.get(root);
  if (cached !== undefined) return cached;
  let hasIdentifierEval = false;
  walkAst(root, (node) => {
    if (hasIdentifierEval) return false;
    if (!isNodeOfType(node, "CallExpression")) return;
    const callee = stripParenExpression(node.callee);
    if (isNodeOfType(callee, "Identifier") && callee.name === "eval") {
      hasIdentifierEval = true;
    }
  });
  identifierEvalByRoot.set(root, hasIdentifierEval);
  return hasIdentifierEval;
};
