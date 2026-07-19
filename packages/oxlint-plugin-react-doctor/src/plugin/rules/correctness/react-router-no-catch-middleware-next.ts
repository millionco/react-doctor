import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findEnclosingFunction } from "../../utils/find-enclosing-function.js";
import { getReactRouterMiddlewareNextSymbol } from "../../utils/get-react-router-middleware-next-symbol.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { wrapReactRouterRule } from "../../utils/wrap-react-router-rule.js";

const unwrapNextCall = (statement: EsTreeNode): EsTreeNodeOfType<"CallExpression"> | null => {
  const expression = isNodeOfType(statement, "ReturnStatement")
    ? statement.argument
    : isNodeOfType(statement, "ExpressionStatement")
      ? statement.expression
      : null;
  const awaitedExpression = isNodeOfType(expression, "AwaitExpression")
    ? expression.argument
    : expression;
  return isNodeOfType(awaitedExpression, "CallExpression") ? awaitedExpression : null;
};

export const reactRouterNoCatchMiddlewareNext = wrapReactRouterRule(
  defineRule({
    id: "react-router-no-catch-middleware-next",
    title: "Middleware catch cannot observe downstream errors",
    tags: ["test-noise"],
    requires: ["react-router:7.8", "react-router-framework"],
    severity: "warn",
    recommendation:
      "Use an ErrorBoundary, handleError, or middleware response instrumentation instead of catching next().",
    create: (context: RuleContext) => ({
      TryStatement(node: EsTreeNodeOfType<"TryStatement">) {
        if (node.handler === null || node.block.body.length !== 1) return;
        const nextCall = unwrapNextCall(node.block.body[0]!);
        if (nextCall === null || !isNodeOfType(nextCall.callee, "Identifier")) return;
        const middlewareFunction = findEnclosingFunction(node);
        if (middlewareFunction === null) return;
        const nextSymbol = getReactRouterMiddlewareNextSymbol(context, middlewareFunction);
        if (nextSymbol === null || context.scopes.symbolFor(nextCall.callee) !== nextSymbol) return;
        context.report({
          node,
          message:
            "This catch cannot observe downstream route errors because next() returns their rendered Response.",
        });
      },
    }),
  }),
);
