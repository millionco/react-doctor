import type { EsTreeNode } from "./es-tree-node.js";
import { collectFunctionReturnStatements } from "./collect-function-return-statements.js";
import { isFunctionLike } from "./is-function-like.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { stripParenExpression } from "./strip-paren-expression.js";

const isNullExpression = (expression: EsTreeNode): boolean => {
  const candidate = stripParenExpression(expression);
  return isNodeOfType(candidate, "Literal") && candidate.value === null;
};

export const functionReturnsOnlyNull = (functionNode: EsTreeNode): boolean => {
  if (!isFunctionLike(functionNode)) return false;
  if (!isNodeOfType(functionNode.body, "BlockStatement")) {
    return isNullExpression(functionNode.body);
  }
  const returnStatements = collectFunctionReturnStatements(functionNode);
  return (
    returnStatements.length > 0 &&
    returnStatements.every((returnStatement) =>
      Boolean(returnStatement.argument && isNullExpression(returnStatement.argument)),
    )
  );
};
