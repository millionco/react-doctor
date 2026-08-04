import ts from "typescript";
import { getEnclosingFunction } from "./get-enclosing-function.js";
import { hasConditionalAncestor } from "./has-conditional-ancestor.js";

export const isEntryDominatingNode = (
  node: ts.Node,
  functionNode: ts.FunctionLikeDeclaration,
): boolean => {
  if (
    getEnclosingFunction(node) !== functionNode ||
    hasConditionalAncestor(node, functionNode) ||
    !functionNode.body
  ) {
    return false;
  }
  if (!ts.isBlock(functionNode.body)) return functionNode.body === node;
  const firstStatement = functionNode.body.statements[0];
  return Boolean(
    firstStatement &&
    ((ts.isExpressionStatement(firstStatement) && firstStatement.expression === node) ||
      (ts.isReturnStatement(firstStatement) && firstStatement.expression === node)),
  );
};
