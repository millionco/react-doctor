import { REACT_ROUTER_SEQUENTIAL_AWAIT_THRESHOLD } from "../../constants/react-router.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findSequentialIndependentAwait } from "../../utils/find-sequential-independent-await.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isReactRouterRouteFunction } from "../../utils/is-react-router-route-function.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { wrapReactRouterRule } from "../../utils/wrap-react-router-rule.js";

const isGlobalFetchCall = (context: RuleContext, expression: EsTreeNode): boolean =>
  isNodeOfType(expression, "CallExpression") &&
  isNodeOfType(expression.callee, "Identifier") &&
  expression.callee.name === "fetch" &&
  context.scopes.isGlobalReference(expression.callee);

export const reactRouterLoaderParallelFetch = wrapReactRouterRule(
  defineRule({
    id: "react-router-loader-parallel-fetch",
    title: "Independent loader work runs sequentially",
    tags: ["test-noise"],
    requires: ["react-router:6.4"],
    severity: "warn",
    category: "Performance",
    recommendation:
      "Start independent loader work together with Promise.all to avoid adding serial latency to navigation.",
    create: (context: RuleContext) => ({
      BlockStatement(node: EsTreeNodeOfType<"BlockStatement">) {
        const functionNode = node.parent;
        if (functionNode === null || functionNode === undefined) return;
        if (
          !isReactRouterRouteFunction(context, functionNode, "loader") &&
          !isReactRouterRouteFunction(context, functionNode, "clientLoader")
        ) {
          return;
        }
        const sequentialAwait = findSequentialIndependentAwait(
          node,
          REACT_ROUTER_SEQUENTIAL_AWAIT_THRESHOLD,
          (expression) => isGlobalFetchCall(context, expression),
        );
        if (sequentialAwait === null) return;
        context.report({
          node: sequentialAwait,
          message:
            "Independent awaits run sequentially in this loader and create a navigation waterfall.",
        });
      },
    }),
  }),
);
