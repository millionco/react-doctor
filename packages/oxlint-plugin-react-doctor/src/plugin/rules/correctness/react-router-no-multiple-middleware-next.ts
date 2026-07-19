import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import { findEnclosingFunction } from "../../utils/find-enclosing-function.js";
import { getReactRouterMiddlewareNextSymbol } from "../../utils/get-react-router-middleware-next-symbol.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { wrapReactRouterRule } from "../../utils/wrap-react-router-rule.js";

export const reactRouterNoMultipleMiddlewareNext = wrapReactRouterRule(
  defineRule({
    id: "react-router-no-multiple-middleware-next",
    title: "Middleware continuation called twice",
    tags: ["test-noise"],
    requires: ["react-router:7.9", "react-router-framework"],
    severity: "error",
    recommendation: "Call next exactly once and reuse the returned Response.",
    create: (context: RuleContext) => {
      const inspectedFunctions = new WeakSet<EsTreeNode>();
      const inspectFunction = (functionNode: EsTreeNode): void => {
        if (!isFunctionLike(functionNode) || inspectedFunctions.has(functionNode)) return;
        inspectedFunctions.add(functionNode);
        const nextSymbol = getReactRouterMiddlewareNextSymbol(context, functionNode);
        if (nextSymbol === null) return;
        const nextCalls = nextSymbol.references
          .map((reference) => reference.identifier.parent)
          .filter(
            (parent): parent is EsTreeNode =>
              isNodeOfType(parent, "CallExpression") &&
              parent.callee.type === "Identifier" &&
              findEnclosingFunction(parent) === functionNode,
          );
        const hasUnconditionalCall = nextCalls.some((call) =>
          context.cfg.isUnconditionalFromEntry(call),
        );
        if (!hasUnconditionalCall || nextCalls.length < 2) return;
        context.report({
          node: nextCalls[1] ?? nextCalls[0]!,
          message: "Two next() calls can execute on the same middleware path.",
        });
      };
      return {
        ArrowFunctionExpression: inspectFunction,
        FunctionDeclaration: inspectFunction,
        FunctionExpression: inspectFunction,
      };
    },
  }),
);
