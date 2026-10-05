import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";

const collectRenderReachableExpressionsFromStatements = (
  statements: EsTreeNode[] | undefined,
  renderReachableExpressions: EsTreeNode[],
): boolean => {
  let hasRenderExit = false;
  for (const statement of statements ?? []) {
    if (collectRenderReachableExpressionsFromStatement(statement, renderReachableExpressions)) {
      hasRenderExit = true;
    }
  }
  return hasRenderExit;
};

const collectRenderReachableExpressionsFromStatement = (
  statement: EsTreeNode,
  renderReachableExpressions: EsTreeNode[],
): boolean => {
  if (isNodeOfType(statement, "ReturnStatement") || isNodeOfType(statement, "ThrowStatement")) {
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
    const consequentHasRenderExit = collectRenderReachableExpressionsFromStatement(
      statement.consequent,
      renderReachableExpressions,
    );
    const alternateHasRenderExit = statement.alternate
      ? collectRenderReachableExpressionsFromStatement(
          statement.alternate,
          renderReachableExpressions,
        )
      : false;
    if (consequentHasRenderExit || alternateHasRenderExit) {
      renderReachableExpressions.push(statement.test);
    }
    return consequentHasRenderExit || alternateHasRenderExit;
  }

  if (isNodeOfType(statement, "SwitchStatement")) {
    let hasRenderExit = false;
    for (const switchCase of statement.cases ?? []) {
      const caseHasRenderExit = collectRenderReachableExpressionsFromStatements(
        switchCase.consequent,
        renderReachableExpressions,
      );
      if (!caseHasRenderExit) continue;
      hasRenderExit = true;
      if (switchCase.test) renderReachableExpressions.push(switchCase.test);
    }
    if (hasRenderExit) renderReachableExpressions.push(statement.discriminant);
    return hasRenderExit;
  }

  if (isNodeOfType(statement, "TryStatement")) {
    const blockHasRenderExit = collectRenderReachableExpressionsFromStatement(
      statement.block,
      renderReachableExpressions,
    );
    const handlerHasRenderExit = statement.handler
      ? collectRenderReachableExpressionsFromStatement(
          statement.handler.body,
          renderReachableExpressions,
        )
      : false;
    const finalizerHasRenderExit = statement.finalizer
      ? collectRenderReachableExpressionsFromStatement(
          statement.finalizer,
          renderReachableExpressions,
        )
      : false;
    return blockHasRenderExit || handlerHasRenderExit || finalizerHasRenderExit;
  }

  if (isNodeOfType(statement, "WhileStatement") || isNodeOfType(statement, "DoWhileStatement")) {
    const bodyHasRenderExit = collectRenderReachableExpressionsFromStatement(
      statement.body,
      renderReachableExpressions,
    );
    if (bodyHasRenderExit) renderReachableExpressions.push(statement.test);
    return bodyHasRenderExit;
  }

  if (isNodeOfType(statement, "ForStatement")) {
    const bodyHasRenderExit = collectRenderReachableExpressionsFromStatement(
      statement.body,
      renderReachableExpressions,
    );
    if (!bodyHasRenderExit) return false;
    if (statement.init) renderReachableExpressions.push(statement.init);
    if (statement.test) renderReachableExpressions.push(statement.test);
    if (statement.update) renderReachableExpressions.push(statement.update);
    return true;
  }

  if (isNodeOfType(statement, "ForInStatement") || isNodeOfType(statement, "ForOfStatement")) {
    const bodyHasRenderExit = collectRenderReachableExpressionsFromStatement(
      statement.body,
      renderReachableExpressions,
    );
    if (!bodyHasRenderExit) return false;
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
    const bodyHasRenderExit = collectRenderReachableExpressionsFromStatement(
      statement.body,
      renderReachableExpressions,
    );
    if (bodyHasRenderExit) renderReachableExpressions.push(statement.object);
    return bodyHasRenderExit;
  }

  return false;
};

export const collectRenderReachableExpressions = (componentBody: EsTreeNode): EsTreeNode[] => {
  if (!isNodeOfType(componentBody, "BlockStatement")) return [];
  const renderReachableExpressions: EsTreeNode[] = [];
  collectRenderReachableExpressionsFromStatements(componentBody.body, renderReachableExpressions);
  return renderReachableExpressions;
};
