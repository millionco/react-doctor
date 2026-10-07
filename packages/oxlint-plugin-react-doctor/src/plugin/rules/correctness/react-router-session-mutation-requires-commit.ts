import { REACT_ROUTER_SESSION_MUTATOR_NAMES } from "../../constants/react-router.js";
import { defineRule } from "../../utils/define-rule.js";
import { doNodesCoverEveryPathAfterNode } from "../../utils/do-nodes-cover-every-path-after-node.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findEnclosingFunction } from "../../utils/find-enclosing-function.js";
import { getStaticPropertyKeyName } from "../../utils/get-static-property-key-name.js";
import { isAstDescendant } from "../../utils/is-ast-descendant.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isNodeReachableWithinFunction } from "../../utils/is-node-reachable-within-function.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isReactRouterRouteFunction } from "../../utils/is-react-router-route-function.js";
import { isReactRouterSessionMethod } from "../../utils/is-react-router-session-method.js";
import { isReactRouterSessionMethodCall } from "../../utils/is-react-router-session-method-call.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { walkAst } from "../../utils/walk-ast.js";
import { wrapReactRouterRule } from "../../utils/wrap-react-router-rule.js";

const isReturnedSetCookieValue = (node: EsTreeNode, routeFunction: EsTreeNode): boolean => {
  let ancestor = node.parent;
  let setCookieProperty: EsTreeNodeOfType<"Property"> | null = null;
  while (ancestor && ancestor !== routeFunction) {
    const propertyName = isNodeOfType(ancestor, "Property")
      ? getStaticPropertyKeyName(ancestor, { allowComputedString: true })
      : null;
    if (
      isNodeOfType(ancestor, "Property") &&
      propertyName?.toLowerCase() === "set-cookie" &&
      isAstDescendant(node, ancestor.value)
    ) {
      setCookieProperty = ancestor;
      break;
    }
    ancestor = ancestor.parent;
  }
  if (setCookieProperty === null) return false;
  ancestor = setCookieProperty.parent;
  while (ancestor && ancestor !== routeFunction) {
    if (isNodeOfType(ancestor, "ReturnStatement")) return true;
    ancestor = ancestor.parent;
  }
  return (
    isNodeOfType(routeFunction, "ArrowFunctionExpression") &&
    !isNodeOfType(routeFunction.body, "BlockStatement") &&
    isAstDescendant(setCookieProperty, routeFunction.body)
  );
};

const findSerializedCookieSinks = (
  context: RuleContext,
  commitCall: EsTreeNodeOfType<"CallExpression">,
  routeFunction: EsTreeNode,
): EsTreeNode[] => {
  if (isReturnedSetCookieValue(commitCall, routeFunction)) return [commitCall];
  const awaitedValue = isNodeOfType(commitCall.parent, "AwaitExpression")
    ? commitCall.parent
    : commitCall;
  const declarator = awaitedValue.parent;
  if (!isNodeOfType(declarator, "VariableDeclarator")) return [];
  if (!isNodeOfType(declarator.id, "Identifier") || declarator.init !== awaitedValue) return [];
  const cookieSymbol = context.scopes.symbolFor(declarator.id);
  if (cookieSymbol?.kind !== "const") return [];
  return cookieSymbol.references.flatMap((reference) =>
    context.cfg.enclosingFunction(reference.identifier) === routeFunction &&
    isReturnedSetCookieValue(reference.identifier, routeFunction)
      ? [reference.identifier]
      : [],
  );
};

export const reactRouterSessionMutationRequiresCommit = wrapReactRouterRule(
  defineRule({
    id: "react-router-session-mutation-requires-commit",
    title: "Session mutation is not committed",
    tags: ["test-noise"],
    requires: ["react-router:7", "react-router-framework"],
    severity: "error",
    recommendation:
      "Serialize the session with commitSession or destroySession and include its Set-Cookie value in the returned Response.",
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
        const mutationCalls: EsTreeNode[] = [];
        for (const reference of sessionSymbol.references) {
          if (context.cfg.enclosingFunction(reference.identifier) !== routeFunction) continue;
          const memberExpression = reference.identifier.parent;
          if (
            isNodeOfType(memberExpression, "CallExpression") &&
            isReactRouterSessionMethodCall(
              context,
              memberExpression,
              sessionSymbol,
              "destroySession",
            ) &&
            isNodeReachableWithinFunction(memberExpression, context)
          ) {
            mutationCalls.push(memberExpression);
            continue;
          }
          if (!isNodeOfType(memberExpression, "MemberExpression")) continue;
          if (memberExpression.object !== reference.identifier) continue;
          const methodName = getStaticPropertyKeyName(memberExpression, {
            allowComputedString: true,
          });
          if (methodName === null || !REACT_ROUTER_SESSION_MUTATOR_NAMES.has(methodName)) {
            continue;
          }
          const callExpression = memberExpression.parent;
          if (
            !isNodeOfType(callExpression, "CallExpression") ||
            callExpression.callee !== memberExpression
          ) {
            continue;
          }
          if (!isNodeReachableWithinFunction(callExpression, context)) continue;
          mutationCalls.push(memberExpression);
        }
        if (mutationCalls.length === 0) return;

        const serializedCookieSinks: EsTreeNode[] = [];
        walkAst(routeFunction, (descendant: EsTreeNode) => {
          if (descendant !== routeFunction && isFunctionLike(descendant)) return false;
          if (!isNodeOfType(descendant, "CallExpression")) return;
          if (
            !isReactRouterSessionMethodCall(context, descendant, sessionSymbol, "commitSession") &&
            !isReactRouterSessionMethodCall(context, descendant, sessionSymbol, "destroySession")
          ) {
            return;
          }
          serializedCookieSinks.push(
            ...findSerializedCookieSinks(context, descendant, routeFunction),
          );
        });
        const uncommittedMutation = mutationCalls.find(
          (mutationCall) =>
            !doNodesCoverEveryPathAfterNode(mutationCall, serializedCookieSinks, context),
        );
        if (uncommittedMutation === undefined) return;
        context.report({
          node: uncommittedMutation,
          message:
            "This action has a path that returns after changing a session without serializing it to a Set-Cookie header.",
        });
      },
    }),
  }),
);
