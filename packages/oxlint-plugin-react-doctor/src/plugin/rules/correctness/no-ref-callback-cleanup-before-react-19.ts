import type { ScopeAnalysis } from "../../semantic/scope-analysis.js";
import { collectFunctionReturnStatements } from "../../utils/collect-function-return-statements.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getDirectConstInitializer } from "../../utils/get-direct-const-initializer.js";
import { getJsxAttributeName } from "../../utils/get-jsx-attribute-name.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isReactApiCall } from "../../utils/is-react-api-call.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";

const resolveFunctionExpressions = (
  rawExpression: EsTreeNode,
  scopes: ScopeAnalysis,
  visitedSymbolIds: ReadonlySet<number> = new Set(),
): ReadonlyArray<EsTreeNode> => {
  const expression = stripParenExpression(rawExpression);
  if (isFunctionLike(expression)) {
    return expression.async || expression.generator ? [] : [expression];
  }
  if (isNodeOfType(expression, "ConditionalExpression")) {
    if (isNodeOfType(expression.test, "Literal")) {
      return resolveFunctionExpressions(
        expression.test.value ? expression.consequent : expression.alternate,
        scopes,
        visitedSymbolIds,
      );
    }
    return [
      ...resolveFunctionExpressions(expression.consequent, scopes, visitedSymbolIds),
      ...resolveFunctionExpressions(expression.alternate, scopes, visitedSymbolIds),
    ];
  }
  if (isNodeOfType(expression, "LogicalExpression")) {
    if (isNodeOfType(expression.left, "Literal")) {
      const isLeftTruthy = Boolean(expression.left.value);
      if (expression.operator === "&&" && !isLeftTruthy) return [];
      if (expression.operator === "||" && isLeftTruthy) return [];
      if (expression.operator === "??" && expression.left.value !== null) return [];
    }
    if (expression.operator === "&&") {
      return resolveFunctionExpressions(expression.right, scopes, visitedSymbolIds);
    }
    return [
      ...resolveFunctionExpressions(expression.left, scopes, visitedSymbolIds),
      ...resolveFunctionExpressions(expression.right, scopes, visitedSymbolIds),
    ];
  }
  if (isNodeOfType(expression, "SequenceExpression")) {
    const finalExpression = expression.expressions.at(-1);
    return finalExpression
      ? resolveFunctionExpressions(finalExpression, scopes, visitedSymbolIds)
      : [];
  }
  if (isNodeOfType(expression, "CallExpression")) {
    if (!isReactApiCall(expression, "useCallback", scopes)) return [];
    const callback = expression.arguments[0];
    return callback && !isNodeOfType(callback, "SpreadElement")
      ? resolveFunctionExpressions(callback, scopes, visitedSymbolIds)
      : [];
  }
  if (!isNodeOfType(expression, "Identifier")) return [];

  const symbol = scopes.symbolFor(expression);
  if (!symbol || visitedSymbolIds.has(symbol.id)) return [];
  if (
    symbol.kind === "function" &&
    isNodeOfType(symbol.declarationNode, "FunctionDeclaration") &&
    symbol.references.every((reference) => reference.flag === "read")
  ) {
    return resolveFunctionExpressions(
      symbol.declarationNode,
      scopes,
      new Set([...visitedSymbolIds, symbol.id]),
    );
  }
  const initializer = getDirectConstInitializer(symbol);
  if (!initializer) return [];
  return resolveFunctionExpressions(initializer, scopes, new Set([...visitedSymbolIds, symbol.id]));
};

const functionReturnsCleanupFunction = (
  functionExpression: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  if (!isFunctionLike(functionExpression)) return false;
  if (!isNodeOfType(functionExpression.body, "BlockStatement")) {
    return resolveFunctionExpressions(functionExpression.body, scopes).length > 0;
  }
  return collectFunctionReturnStatements(functionExpression).some((returnStatement) =>
    Boolean(
      returnStatement.argument &&
      resolveFunctionExpressions(returnStatement.argument, scopes).length > 0,
    ),
  );
};

const callbackReturnsCleanupFunction = (callback: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  return resolveFunctionExpressions(callback, scopes).some((functionExpression) =>
    functionReturnsCleanupFunction(functionExpression, scopes),
  );
};

export const noRefCallbackCleanupBeforeReact19 = defineRule({
  id: "no-ref-callback-cleanup-before-react-19",
  title: "Ref cleanup requires React 19",
  requires: ["react:18"],
  disabledWhen: ["react:19"],
  severity: "warn",
  recommendation:
    "React 18 ignores functions returned from ref callbacks. Handle cleanup when React calls the ref with `null`, or require React 19 before returning a cleanup function.",
  create: (context) => ({
    JSXAttribute(node: EsTreeNodeOfType<"JSXAttribute">) {
      if (getJsxAttributeName(node.name) !== "ref") return;
      if (!isNodeOfType(node.value, "JSXExpressionContainer")) return;
      const callback = node.value.expression;
      if (!callback || isNodeOfType(callback, "JSXEmptyExpression")) return;
      if (!callbackReturnsCleanupFunction(callback, context.scopes)) return;
      context.report({
        node,
        message:
          "This ref callback returns a cleanup function, but React 18 ignores ref cleanup returns, so the cleanup never runs. Handle detachment when React calls the ref with `null`, or require React 19.",
      });
    },
  }),
});
