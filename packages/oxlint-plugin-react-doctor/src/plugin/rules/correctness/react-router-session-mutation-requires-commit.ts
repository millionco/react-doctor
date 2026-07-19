import { REACT_ROUTER_SESSION_MUTATOR_NAMES } from "../../constants/react-router.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findEnclosingFunction } from "../../utils/find-enclosing-function.js";
import { getStaticPropertyKeyName } from "../../utils/get-static-property-key-name.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isReactRouterRouteFunction } from "../../utils/is-react-router-route-function.js";
import { isReactRouterSessionMethod } from "../../utils/is-react-router-session-method.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { walkAst } from "../../utils/walk-ast.js";
import { wrapReactRouterRule } from "../../utils/wrap-react-router-rule.js";

export const reactRouterSessionMutationRequiresCommit = wrapReactRouterRule(
  defineRule({
    id: "react-router-session-mutation-requires-commit",
    title: "Session mutation is not committed",
    tags: ["test-noise"],
    requires: ["react-router:7", "react-router-framework"],
    severity: "error",
    recommendation:
      "Serialize the mutated session with commitSession and include its Set-Cookie value in the returned Response.",
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
        const routeFunction = findEnclosingFunction(node);
        if (
          routeFunction === null ||
          !isReactRouterRouteFunction(context, routeFunction, "action")
        ) {
          return;
        }
        const sessionSymbol = context.scopes.symbolFor(node.id);
        if (sessionSymbol === null) return;
        const mutationCall = sessionSymbol.references
          .map((reference) => reference.identifier.parent)
          .find((parent) => {
            if (!isNodeOfType(parent, "MemberExpression")) return false;
            const methodName = getStaticPropertyKeyName(parent, { allowComputedString: true });
            return methodName !== null && REACT_ROUTER_SESSION_MUTATOR_NAMES.has(methodName);
          });
        if (mutationCall === undefined || mutationCall === null) return;

        let hasCommit = false;
        walkAst(routeFunction, (descendant: EsTreeNode) => {
          if (hasCommit || !isNodeOfType(descendant, "CallExpression")) return;
          if (!isNodeOfType(descendant.callee, "Identifier")) return;
          if (
            !isReactRouterSessionMethod(
              context,
              context.scopes.symbolFor(descendant.callee),
              "commitSession",
            )
          ) {
            return;
          }
          const sessionArgument = descendant.arguments?.[0];
          if (sessionArgument && context.scopes.symbolFor(sessionArgument) === sessionSymbol) {
            hasCommit = true;
          }
        });
        if (hasCommit) return;
        context.report({
          node: mutationCall,
          message:
            "This action mutates a session but never commits that session to a Set-Cookie header.",
        });
      },
    }),
  }),
);
