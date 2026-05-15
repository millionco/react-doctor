import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";

const collectRenderReachableExpressionsFromStatements = (
  statements: EsTreeNode[] | undefined,
  renderReachableExpressions: EsTreeNode[],
): boolean => {
  let hasReturn = false;
  for (const statement of statements ?? []) {
    if (collectRenderReachableExpressionsFromStatement(statement, renderReachableExpressions)) {
      hasReturn = true;
    }
  }
  return hasReturn;
};

const collectRenderReachableExpressionsFromStatement = (
  statement: EsTreeNode,
  renderReachableExpressions: EsTreeNode[],
): boolean => {
  if (isNodeOfType(statement, "ReturnStatement")) {
    if (statement.argument) renderReachableExpressions.push(statement.argument);
    return true;
  }

  if (isNodeOfType(statement, "BlockStatement")) {
    return collectRenderReachableExpressionsFromStatements(
      statement.body,
      renderReachableExpressions,
    );
  }

  if (isNodeOfType(statement, "IfStatement")) {
    const consequentHasReturn = collectRenderReachableExpressionsFromStatement(
      statement.consequent,
      renderReachableExpressions,
    );
    const alternateHasReturn = statement.alternate
      ? collectRenderReachableExpressionsFromStatement(
          statement.alternate,
          renderReachableExpressions,
        )
      : false;
    if (consequentHasReturn || alternateHasReturn) {
      renderReachableExpressions.push(statement.test);
    }
    return consequentHasReturn || alternateHasReturn;
  }

  if (isNodeOfType(statement, "SwitchStatement")) {
    let hasReturn = false;
    for (const switchCase of statement.cases ?? []) {
      const caseHasReturn = collectRenderReachableExpressionsFromStatements(
        switchCase.consequent,
        renderReachableExpressions,
      );
      if (!caseHasReturn) continue;
      hasReturn = true;
      if (switchCase.test) renderReachableExpressions.push(switchCase.test);
    }
    if (hasReturn) renderReachableExpressions.push(statement.discriminant);
    return hasReturn;
  }

  if (isNodeOfType(statement, "TryStatement")) {
    const blockHasReturn = collectRenderReachableExpressionsFromStatement(
      statement.block,
      renderReachableExpressions,
    );
    const handlerHasReturn = statement.handler
      ? collectRenderReachableExpressionsFromStatement(
          statement.handler.body,
          renderReachableExpressions,
        )
      : false;
    const finalizerHasReturn = statement.finalizer
      ? collectRenderReachableExpressionsFromStatement(
          statement.finalizer,
          renderReachableExpressions,
        )
      : false;
    return blockHasReturn || handlerHasReturn || finalizerHasReturn;
  }

  if (isNodeOfType(statement, "WhileStatement") || isNodeOfType(statement, "DoWhileStatement")) {
    const bodyHasReturn = collectRenderReachableExpressionsFromStatement(
      statement.body,
      renderReachableExpressions,
    );
    if (bodyHasReturn) renderReachableExpressions.push(statement.test);
    return bodyHasReturn;
  }

  if (isNodeOfType(statement, "ForStatement")) {
    const bodyHasReturn = collectRenderReachableExpressionsFromStatement(
      statement.body,
      renderReachableExpressions,
    );
    if (!bodyHasReturn) return false;
    if (statement.init) renderReachableExpressions.push(statement.init);
    if (statement.test) renderReachableExpressions.push(statement.test);
    if (statement.update) renderReachableExpressions.push(statement.update);
    return true;
  }

  if (isNodeOfType(statement, "ForInStatement") || isNodeOfType(statement, "ForOfStatement")) {
    const bodyHasReturn = collectRenderReachableExpressionsFromStatement(
      statement.body,
      renderReachableExpressions,
    );
    if (!bodyHasReturn) return false;
    renderReachableExpressions.push(statement.right);
    return true;
  }

  if (isNodeOfType(statement, "LabeledStatement")) {
    return collectRenderReachableExpressionsFromStatement(
      statement.body,
      renderReachableExpressions,
    );
  }

  if (isNodeOfType(statement, "WithStatement")) {
    const bodyHasReturn = collectRenderReachableExpressionsFromStatement(
      statement.body,
      renderReachableExpressions,
    );
    if (bodyHasReturn) renderReachableExpressions.push(statement.object);
    return bodyHasReturn;
  }

  return false;
};

export const collectRenderReachableExpressions = (componentBody: EsTreeNode): EsTreeNode[] => {
  if (!isNodeOfType(componentBody, "BlockStatement")) return [];
  const renderReachableExpressions: EsTreeNode[] = [];
  collectRenderReachableExpressionsFromStatements(componentBody.body, renderReachableExpressions);
  return renderReachableExpressions;
};
