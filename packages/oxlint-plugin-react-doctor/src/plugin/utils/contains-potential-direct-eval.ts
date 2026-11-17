import type { EsTreeNode } from "./es-tree-node.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { stripParenExpression } from "./strip-paren-expression.js";
import { walkAst } from "./walk-ast.js";

const potentialDirectEvalByProgram = new WeakMap<EsTreeNode, boolean>();

export const containsPotentialDirectEval = (programNode: EsTreeNode): boolean => {
  const cachedResult = potentialDirectEvalByProgram.get(programNode);
  if (cachedResult !== undefined) return cachedResult;

  let foundPotentialDirectEval = false;
  walkAst(programNode, (node) => {
    if (foundPotentialDirectEval) return false;
    if (!isNodeOfType(node, "CallExpression") || node.arguments.length === 0) {
      return;
    }
    // Downlevel TypeScript can emit an optional bare eval as a direct call.
    const callee = stripParenExpression(node.callee);
    if (isNodeOfType(callee, "Identifier") && callee.name === "eval") {
      foundPotentialDirectEval = true;
      return false;
    }
  });

  potentialDirectEvalByProgram.set(programNode, foundPotentialDirectEval);
  return foundPotentialDirectEval;
};
