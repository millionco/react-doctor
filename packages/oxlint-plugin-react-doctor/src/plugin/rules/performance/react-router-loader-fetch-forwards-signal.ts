import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findEnclosingFunction } from "../../utils/find-enclosing-function.js";
import { getDestructuredBindingPropertyName } from "../../utils/get-destructured-binding-property-name.js";
import { getDirectUnreassignedInitializer } from "../../utils/get-direct-unreassigned-initializer.js";
import { getStaticPropertyKeyName } from "../../utils/get-static-property-key-name.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isReactRouterRouteFunction } from "../../utils/is-react-router-route-function.js";
import { isRouteRequestExpression } from "../../utils/is-route-request-expression.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { wrapReactRouterRule } from "../../utils/wrap-react-router-rule.js";

const isLoaderFunction = (context: RuleContext, functionNode: EsTreeNode): boolean =>
  isReactRouterRouteFunction(context, functionNode, "loader") ||
  isReactRouterRouteFunction(context, functionNode, "clientLoader");

const hasRouteRequestParameter = (functionNode: EsTreeNode): boolean => {
  if (!isFunctionLike(functionNode)) return false;
  const firstParameter = functionNode.params?.[0];
  if (isNodeOfType(firstParameter, "Identifier")) return true;
  if (!isNodeOfType(firstParameter, "ObjectPattern")) return false;
  return (firstParameter.properties ?? []).some(
    (property) => getStaticPropertyKeyName(property, { allowComputedString: true }) === "request",
  );
};

const isRequestSignal = (
  context: RuleContext,
  expression: EsTreeNode,
  loaderFunction: EsTreeNode,
  visitedSymbolIds = new Set<number>(),
): boolean => {
  const candidate = stripParenExpression(expression);
  if (
    isNodeOfType(candidate, "MemberExpression") &&
    getStaticPropertyKeyName(candidate, { allowComputedString: true }) === "signal" &&
    isRouteRequestExpression(context, candidate.object, loaderFunction)
  ) {
    return true;
  }
  if (!isNodeOfType(candidate, "Identifier")) return false;
  const symbol = context.scopes.symbolFor(candidate);
  if (symbol === null || visitedSymbolIds.has(symbol.id)) return false;
  visitedSymbolIds.add(symbol.id);
  const destructuredPropertyName = getDestructuredBindingPropertyName(symbol.bindingIdentifier);
  if (destructuredPropertyName !== null) {
    return (
      symbol.kind === "const" &&
      destructuredPropertyName === "signal" &&
      symbol.initializer !== null &&
      isRouteRequestExpression(context, symbol.initializer, loaderFunction)
    );
  }
  const initializer = getDirectUnreassignedInitializer(symbol);
  if (initializer === null) return false;
  return isRequestSignal(context, initializer, loaderFunction, visitedSymbolIds);
};

const optionsForwardRequestSignal = (
  context: RuleContext,
  options: EsTreeNode | null | undefined,
  loaderFunction: EsTreeNode,
): boolean => {
  if (!options) return false;
  const candidate = stripParenExpression(options);
  if (
    (isNodeOfType(candidate, "Literal") && candidate.value === null) ||
    (isNodeOfType(candidate, "UnaryExpression") && candidate.operator === "void") ||
    (isNodeOfType(candidate, "Identifier") &&
      candidate.name === "undefined" &&
      context.scopes.isGlobalReference(candidate))
  ) {
    return false;
  }
  if (!isNodeOfType(candidate, "ObjectExpression")) return true;
  for (const property of candidate.properties ?? []) {
    if (isNodeOfType(property, "SpreadElement")) return true;
    if (getStaticPropertyKeyName(property, { allowComputedString: true }) !== "signal") continue;
    return (
      isNodeOfType(property, "Property") && isRequestSignal(context, property.value, loaderFunction)
    );
  }
  return false;
};

const requestInputForwardsSignal = (
  context: RuleContext,
  input: EsTreeNode | null | undefined,
  loaderFunction: EsTreeNode,
): boolean => {
  if (!input) return false;
  const candidate = stripParenExpression(input);
  if (isRouteRequestExpression(context, candidate, loaderFunction)) return true;
  if (!isNodeOfType(candidate, "NewExpression")) return false;
  if (!isNodeOfType(candidate.callee, "Identifier") || candidate.callee.name !== "Request") {
    return false;
  }
  if (!context.scopes.isGlobalReference(candidate.callee)) return false;
  return optionsForwardRequestSignal(context, candidate.arguments?.[1], loaderFunction);
};

export const reactRouterLoaderFetchForwardsSignal = wrapReactRouterRule(
  defineRule({
    id: "react-router-loader-fetch-forwards-signal",
    title: "Loader fetch ignores cancellation",
    tags: ["test-noise"],
    requires: ["react-router:6.4"],
    severity: "warn",
    category: "Performance",
    recommendation:
      "Pass request.signal to fetch so superseded navigations cancel work that no longer contributes to the route.",
    create: (context: RuleContext) => ({
      CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
        if (!isNodeOfType(node.callee, "Identifier") || node.callee.name !== "fetch") return;
        if (!context.scopes.isGlobalReference(node.callee)) return;
        const loaderFunction = findEnclosingFunction(node);
        if (loaderFunction === null || !isLoaderFunction(context, loaderFunction)) return;
        if (!hasRouteRequestParameter(loaderFunction)) return;
        const requestInput = node.arguments?.[0];
        if (requestInputForwardsSignal(context, requestInput, loaderFunction)) return;

        const options = node.arguments?.[1];
        if (optionsForwardRequestSignal(context, options, loaderFunction)) return;
        context.report({
          node,
          message:
            "fetch() in this loader does not receive request.signal, so abandoned navigation work continues.",
        });
      },
    }),
  }),
);
