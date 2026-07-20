import { REACT_ROUTER_SESSION_MUTATOR_NAMES } from "../../constants/react-router.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findEnclosingFunction } from "../../utils/find-enclosing-function.js";
import { getStaticPropertyKeyName } from "../../utils/get-static-property-key-name.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isReactRouterRouteFunction } from "../../utils/is-react-router-route-function.js";
import { isReactRouterSessionMethod } from "../../utils/is-react-router-session-method.js";
import { isReactRouterSessionMethodCall } from "../../utils/is-react-router-session-method-call.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { wrapReactRouterRule } from "../../utils/wrap-react-router-rule.js";

export const reactRouterNoSessionMutationInLoader = wrapReactRouterRule(
  defineRule({
    id: "react-router-no-session-mutation-in-loader",
    title: "Loader mutates session state",
    tags: ["test-noise"],
    requires: ["react-router:7", "react-router-framework"],
    severity: "error",
    recommendation: "Mutate and commit sessions in an action, then redirect to a loader.",
    create: (context: RuleContext) => ({
      VariableDeclarator(node: EsTreeNodeOfType<"VariableDeclarator">) {
        if (!isNodeOfType(node.id, "Identifier")) return;
        const awaitedCall = isNodeOfType(node.init, "AwaitExpression")
          ? node.init.argument
          : node.init;
        if (!isNodeOfType(awaitedCall, "CallExpression")) return;
        if (!isNodeOfType(awaitedCall.callee, "Identifier")) return;
        if (
          !isReactRouterSessionMethod(
            context,
            context.scopes.symbolFor(awaitedCall.callee),
            "getSession",
          )
        ) {
          return;
        }
        const loaderFunction = findEnclosingFunction(node);
        if (
          loaderFunction === null ||
          !isReactRouterRouteFunction(context, loaderFunction, "loader")
        )
          return;
        const sessionSymbol = context.scopes.symbolFor(node.id);
        if (sessionSymbol === null) return;
        for (const reference of sessionSymbol.references) {
          const memberExpression = reference.identifier.parent;
          if (
            isNodeOfType(memberExpression, "CallExpression") &&
            isReactRouterSessionMethodCall(
              context,
              memberExpression,
              sessionSymbol,
              "destroySession",
            )
          ) {
            context.report({
              node: memberExpression,
              message:
                "loader destroys the session with destroySession(), which exposes logout to cross-site GET requests.",
            });
            continue;
          }
          if (!isNodeOfType(memberExpression, "MemberExpression")) continue;
          const methodName = getStaticPropertyKeyName(memberExpression, {
            allowComputedString: true,
          });
          if (methodName === null || !REACT_ROUTER_SESSION_MUTATOR_NAMES.has(methodName)) continue;
          if (
            !isNodeOfType(memberExpression.parent, "CallExpression") ||
            memberExpression.parent.callee !== memberExpression
          ) {
            continue;
          }
          context.report({
            node: memberExpression.parent,
            message: `loader mutates the session with ${methodName}(), which can race parallel loader execution.`,
          });
        }
      },
    }),
  }),
);
