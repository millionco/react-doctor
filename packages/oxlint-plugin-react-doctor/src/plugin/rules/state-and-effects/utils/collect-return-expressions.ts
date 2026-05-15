import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";

const collectReturnExpressionsFromStatements = (
  statements: EsTreeNode[] | undefined,
  returnExpressions: EsTreeNode[],
): boolean => {
  let hasReturn = false;
  for (const statement of statements ?? []) {
    if (collectReturnExpressionsFromStatement(statement, returnExpressions)) {
      hasReturn = true;
    }
  }
  return hasReturn;
};

const collectReturnExpressionsFromStatement = (
  statement: EsTreeNode,
  returnExpressions: EsTreeNode[],
): boolean => {
  if (isNodeOfType(statement, "ReturnStatement")) {
    if (statement.argument) returnExpressions.push(statement.argument);
    return true;
  }

  if (isNodeOfType(statement, "BlockStatement")) {
    return collectReturnExpressionsFromStatements(statement.body, returnExpressions);
  }

  if (isNodeOfType(statement, "IfStatement")) {
    const consequentHasReturn = collectReturnExpressionsFromStatement(
      statement.consequent,
      returnExpressions,
    );
    const alternateHasReturn = statement.alternate
      ? collectReturnExpressionsFromStatement(statement.alternate, returnExpressions)
      : false;
    if (consequentHasReturn || alternateHasReturn) returnExpressions.push(statement.test);
    return consequentHasReturn || alternateHasReturn;
  }

  if (isNodeOfType(statement, "SwitchStatement")) {
    let hasReturn = false;
    for (const switchCase of statement.cases ?? []) {
      const caseHasReturn = collectReturnExpressionsFromStatements(
        switchCase.consequent,
        returnExpressions,
      );
      if (!caseHasReturn) continue;
      hasReturn = true;
      if (switchCase.test) returnExpressions.push(switchCase.test);
    }
    if (hasReturn) returnExpressions.push(statement.discriminant);
    return hasReturn;
  }

  if (isNodeOfType(statement, "TryStatement")) {
    const blockHasReturn = collectReturnExpressionsFromStatement(
      statement.block,
      returnExpressions,
    );
    const handlerHasReturn = statement.handler
      ? collectReturnExpressionsFromStatement(statement.handler.body, returnExpressions)
      : false;
    const finalizerHasReturn = statement.finalizer
      ? collectReturnExpressionsFromStatement(statement.finalizer, returnExpressions)
      : false;
    return blockHasReturn || handlerHasReturn || finalizerHasReturn;
  }

  if (isNodeOfType(statement, "WhileStatement") || isNodeOfType(statement, "DoWhileStatement")) {
    const bodyHasReturn = collectReturnExpressionsFromStatement(statement.body, returnExpressions);
    if (bodyHasReturn) returnExpressions.push(statement.test);
    return bodyHasReturn;
  }

  if (isNodeOfType(statement, "ForStatement")) {
    const bodyHasReturn = collectReturnExpressionsFromStatement(statement.body, returnExpressions);
    if (!bodyHasReturn) return false;
    if (statement.init) returnExpressions.push(statement.init);
    if (statement.test) returnExpressions.push(statement.test);
    if (statement.update) returnExpressions.push(statement.update);
    return true;
  }

  if (isNodeOfType(statement, "ForInStatement") || isNodeOfType(statement, "ForOfStatement")) {
    const bodyHasReturn = collectReturnExpressionsFromStatement(statement.body, returnExpressions);
    if (!bodyHasReturn) return false;
    returnExpressions.push(statement.right);
    return true;
  }

  if (isNodeOfType(statement, "LabeledStatement")) {
    return collectReturnExpressionsFromStatement(statement.body, returnExpressions);
  }

  if (isNodeOfType(statement, "WithStatement")) {
    const bodyHasReturn = collectReturnExpressionsFromStatement(statement.body, returnExpressions);
    if (bodyHasReturn) returnExpressions.push(statement.object);
    return bodyHasReturn;
  }

  return false;
};

export const collectReturnExpressions = (componentBody: EsTreeNode): EsTreeNode[] => {
  if (!isNodeOfType(componentBody, "BlockStatement")) return [];
  const returnExpressions: EsTreeNode[] = [];
  collectReturnExpressionsFromStatements(componentBody.body, returnExpressions);
  return returnExpressions;
};
