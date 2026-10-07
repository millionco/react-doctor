import { defineRule } from "../../utils/define-rule.js";
import { collectFunctionReturnStatements } from "../../utils/collect-function-return-statements.js";
import { doNodesCoverEveryPathAfterNode } from "../../utils/do-nodes-cover-every-path-after-node.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findEnclosingFunction } from "../../utils/find-enclosing-function.js";
import { getReactRouterMiddlewareNextSymbol } from "../../utils/get-react-router-middleware-next-symbol.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { wrapReactRouterRule } from "../../utils/wrap-react-router-rule.js";

const hasLaterReplacementReturn = (
  context: RuleContext,
  middlewareFunction: EsTreeNode,
  responseReceiptStatement: EsTreeNode,
): boolean =>
  doNodesCoverEveryPathAfterNode(
    responseReceiptStatement,
    collectFunctionReturnStatements(middlewareFunction).filter(
      (returnStatement) => returnStatement.argument !== null,
    ),
    context,
  );

const getResponseReceiptStatement = (awaitedExpression: EsTreeNode): EsTreeNode | null => {
  const parent = awaitedExpression.parent;
  if (isNodeOfType(parent, "ExpressionStatement")) return parent;
  if (
    isNodeOfType(parent, "VariableDeclarator") &&
    parent.init === awaitedExpression &&
    isNodeOfType(parent.parent, "VariableDeclaration")
  ) {
    return parent.parent;
  }
  if (
    isNodeOfType(parent, "AssignmentExpression") &&
    parent.right === awaitedExpression &&
    isNodeOfType(parent.parent, "ExpressionStatement")
  ) {
    return parent.parent;
  }
  return null;
};

export const reactRouterServerMiddlewareReturnResponse = wrapReactRouterRule(
  defineRule({
    id: "react-router-server-middleware-return-response",
    title: "Server middleware drops the Response",
    tags: ["test-noise"],
    requires: ["react-router:7.9", "react-router-framework"],
    severity: "error",
    recommendation:
      "Return the Response produced by next(), or return an explicit replacement Response.",
    create: (context: RuleContext) => ({
      CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
        if (!isNodeOfType(node.callee, "Identifier")) return;
        const middlewareFunction = findEnclosingFunction(node);
        if (middlewareFunction === null) return;
        const nextSymbol = getReactRouterMiddlewareNextSymbol(context, middlewareFunction);
        if (nextSymbol === null || context.scopes.symbolFor(node.callee) !== nextSymbol) return;
        const awaitedExpression = isNodeOfType(node.parent, "AwaitExpression") ? node.parent : node;
        const responseReceiptStatement = getResponseReceiptStatement(awaitedExpression);
        if (responseReceiptStatement === null) return;
        if (hasLaterReplacementReturn(context, middlewareFunction, responseReceiptStatement)) {
          return;
        }
        context.report({
          node: responseReceiptStatement,
          message: "Server middleware discards the Response returned by next().",
        });
      },
    }),
  }),
);
