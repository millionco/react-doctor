import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findEnclosingFunction } from "../../utils/find-enclosing-function.js";
import { getReactRouterMiddlewareNextSymbol } from "../../utils/get-react-router-middleware-next-symbol.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { wrapReactRouterRule } from "../../utils/wrap-react-router-rule.js";

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
        if (!isNodeOfType(awaitedExpression.parent, "ExpressionStatement")) return;
        context.report({
          node: awaitedExpression.parent,
          message: "Server middleware discards the Response returned by next().",
        });
      },
    }),
  }),
);
