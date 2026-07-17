import type { ScopeDescriptor, SymbolDescriptor } from "../../semantic/scope-analysis.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getDestructuredBindingPropertyName } from "../../utils/get-destructured-binding-property-name.js";
import { getJsxAttributeName } from "../../utils/get-jsx-attribute-name.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { resolveConstIdentifierAlias } from "../../utils/resolve-const-identifier-alias.js";
import type { RuleContext } from "../../utils/rule-context.js";
import {
  TRANSPARENT_EXPRESSION_WRAPPER_TYPES,
  stripParenExpression,
} from "../../utils/strip-paren-expression.js";
import { resolveTanstackQueryHookNameFromInitializer } from "./utils/resolve-tanstack-query-hook-name.js";

const DISCARDING_CALLBACK_HOST_NAMES = new Set([
  "forEach",
  "requestAnimationFrame",
  "requestIdleCallback",
  "setImmediate",
  "setInterval",
  "setTimeout",
  "useEffect",
  "useInsertionEffect",
  "useLayoutEffect",
]);

const isUseMutationInitializer = (initializer: EsTreeNode, context: RuleContext): boolean =>
  resolveTanstackQueryHookNameFromInitializer(initializer, context.scopes) === "useMutation";

const symbolComesFromUseMutationResult = (
  symbol: SymbolDescriptor | null,
  context: RuleContext,
): boolean => {
  if (!symbol?.initializer) return false;
  const resolvedSymbol = resolveConstIdentifierAlias(symbol.bindingIdentifier, context.scopes);
  return Boolean(
    resolvedSymbol?.initializer && isUseMutationInitializer(resolvedSymbol.initializer, context),
  );
};

const isTanstackMutateAsyncCall = (
  callExpression: EsTreeNodeOfType<"CallExpression">,
  context: RuleContext,
): boolean => {
  const callee = stripParenExpression(callExpression.callee);
  if (isNodeOfType(callee, "MemberExpression")) {
    if (getStaticPropertyName(callee) !== "mutateAsync") return false;
    const resultObject = stripParenExpression(callee.object);
    if (!isNodeOfType(resultObject, "Identifier")) return false;
    return symbolComesFromUseMutationResult(context.scopes.symbolFor(resultObject), context);
  }
  if (!isNodeOfType(callee, "Identifier")) return false;
  const mutateSymbol = context.scopes.symbolFor(callee);
  if (
    !mutateSymbol ||
    getDestructuredBindingPropertyName(mutateSymbol.bindingIdentifier) !== "mutateAsync"
  ) {
    return false;
  }
  return Boolean(
    mutateSymbol.initializer && isUseMutationInitializer(mutateSymbol.initializer, context),
  );
};

const getFunctionBindingIdentifier = (
  functionNode: EsTreeNode,
): EsTreeNodeOfType<"Identifier"> | null => {
  if (isNodeOfType(functionNode, "FunctionDeclaration") && functionNode.id) {
    return functionNode.id;
  }
  const parent = functionNode.parent;
  if (isNodeOfType(parent, "VariableDeclarator") && isNodeOfType(parent.id, "Identifier")) {
    return parent.id;
  }
  return null;
};

const findFunctionSymbol = (
  functionNode: EsTreeNode,
  context: RuleContext,
): SymbolDescriptor | null => {
  const bindingIdentifier = getFunctionBindingIdentifier(functionNode);
  if (!bindingIdentifier) return null;
  let scope: ScopeDescriptor | null = context.scopes.scopeFor(functionNode);
  while (scope) {
    const symbol = scope.symbolsByName.get(bindingIdentifier.name);
    if (symbol?.bindingIdentifier === bindingIdentifier) return symbol;
    scope = scope.parent;
  }
  return null;
};

const isEventHandlerAttributeValue = (expression: EsTreeNode): boolean => {
  const container = expression.parent;
  if (!isNodeOfType(container, "JSXExpressionContainer") || container.expression !== expression) {
    return false;
  }
  const attribute = container.parent;
  if (!isNodeOfType(attribute, "JSXAttribute")) return false;
  const attributeName = getJsxAttributeName(attribute.name);
  return Boolean(attributeName && /^on[A-Z]/.test(attributeName));
};

const isDiscardingCallbackHost = (callExpression: EsTreeNodeOfType<"CallExpression">): boolean => {
  const callee = stripParenExpression(callExpression.callee);
  if (isNodeOfType(callee, "Identifier")) {
    return DISCARDING_CALLBACK_HOST_NAMES.has(callee.name);
  }
  return (
    isNodeOfType(callee, "MemberExpression") &&
    DISCARDING_CALLBACK_HOST_NAMES.has(getStaticPropertyName(callee) ?? "")
  );
};

const isDiscardedCallbackReference = (identifier: EsTreeNode): boolean => {
  if (isEventHandlerAttributeValue(identifier)) return true;
  const callExpression = identifier.parent;
  return Boolean(
    isNodeOfType(callExpression, "CallExpression") &&
    callExpression.arguments.some((argument) => argument === identifier) &&
    isDiscardingCallbackHost(callExpression),
  );
};

const isPossibleCallable = (
  expression: EsTreeNode | null | undefined,
  context: RuleContext,
  visitedSymbols: Set<number> = new Set(),
): boolean => {
  if (!expression) return false;
  const candidate = stripParenExpression(expression);
  if (isFunctionLike(candidate)) return true;
  if (isNodeOfType(candidate, "MemberExpression")) return true;
  if (!isNodeOfType(candidate, "Identifier") || candidate.name === "undefined") return false;
  const symbol = context.scopes.symbolFor(candidate);
  if (!symbol) return false;
  if (symbol.kind === "function" || symbol.kind === "import" || symbol.kind === "parameter") {
    return true;
  }
  if (!symbol.initializer || visitedSymbols.has(symbol.id)) return false;
  visitedSymbols.add(symbol.id);
  return isPossibleCallable(symbol.initializer, context, visitedSymbols);
};

const getEnclosingFunction = (node: EsTreeNode): EsTreeNode | null => {
  let current = node.parent;
  while (current) {
    if (isFunctionLike(current)) return current;
    current = current.parent ?? null;
  }
  return null;
};

const isFunctionReturnDiscarded = (
  functionNode: EsTreeNode,
  context: RuleContext,
  visitedFunctions: Set<EsTreeNode>,
): boolean => {
  if (visitedFunctions.has(functionNode)) return false;
  visitedFunctions.add(functionNode);
  if (isEventHandlerAttributeValue(functionNode)) return true;
  const directParent = functionNode.parent;
  if (
    isNodeOfType(directParent, "CallExpression") &&
    directParent.arguments.some((argument) => argument === functionNode) &&
    isDiscardingCallbackHost(directParent)
  ) {
    return true;
  }
  const functionSymbol = findFunctionSymbol(functionNode, context);
  if (!functionSymbol) return false;
  return functionSymbol.references.some((reference) =>
    isDiscardedCallbackReference(reference.identifier),
  );
};

const isFloatingPromiseUse = (
  callExpression: EsTreeNodeOfType<"CallExpression">,
  context: RuleContext,
): boolean => {
  const visitedFunctions = new Set<EsTreeNode>();
  let current: EsTreeNode = callExpression;
  let parent = current.parent ?? null;
  while (parent) {
    if (
      TRANSPARENT_EXPRESSION_WRAPPER_TYPES.has(parent.type) ||
      isNodeOfType(parent, "ConditionalExpression") ||
      isNodeOfType(parent, "LogicalExpression")
    ) {
      current = parent;
      parent = current.parent ?? null;
      continue;
    }
    if (isNodeOfType(parent, "MemberExpression") && parent.object === current) {
      const chainMethodName = getStaticPropertyName(parent);
      if (
        chainMethodName !== "catch" &&
        chainMethodName !== "then" &&
        chainMethodName !== "finally"
      ) {
        return false;
      }
      const chainCall = parent.parent;
      if (!isNodeOfType(chainCall, "CallExpression") || chainCall.callee !== parent) return false;
      const rejectionHandler =
        chainMethodName === "catch" ? chainCall.arguments[0] : chainCall.arguments[1];
      if (
        (chainMethodName === "catch" || chainMethodName === "then") &&
        isPossibleCallable(rejectionHandler, context)
      ) {
        return false;
      }
      current = chainCall;
      parent = current.parent ?? null;
      continue;
    }
    if (isNodeOfType(parent, "ExpressionStatement")) return true;
    if (isNodeOfType(parent, "ReturnStatement") && parent.argument === current) {
      const enclosingFunction = getEnclosingFunction(parent);
      return Boolean(
        enclosingFunction &&
        isFunctionReturnDiscarded(enclosingFunction, context, visitedFunctions),
      );
    }
    if (isFunctionLike(parent) && parent.body === current) {
      return isFunctionReturnDiscarded(parent, context, visitedFunctions);
    }
    return false;
  }
  return false;
};

export const queryFloatingMutateAsync = defineRule({
  id: "query-floating-mutate-async",
  title: "Floating mutateAsync rejection",
  tags: ["test-noise"],
  requires: ["tanstack-query"],
  severity: "warn",
  recommendation:
    "Await, return, or handle rejection from the `mutateAsync()` promise so a failed mutation cannot become an unhandled rejection.",
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      if (!isTanstackMutateAsyncCall(node, context) || !isFloatingPromiseUse(node, context)) {
        return;
      }
      context.report({
        node,
        message:
          "This `mutateAsync()` promise is discarded without a rejection handler, so a failed mutation becomes an unhandled rejection.",
      });
    },
  }),
});
