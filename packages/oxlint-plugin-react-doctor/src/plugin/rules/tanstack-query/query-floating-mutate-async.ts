import type { SymbolDescriptor } from "../../semantic/scope-analysis.js";
import { TIMER_AND_SCHEDULER_DIRECT_CALLEE_NAMES } from "../../constants/dom.js";
import { collectConstAliasSymbols } from "../../utils/collect-const-alias-symbols.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findCallbackSelectionRoot } from "../../utils/find-callback-selection-root.js";
import { findEnclosingFunction } from "../../utils/find-enclosing-function.js";
import { findTransparentExpressionRoot } from "../../utils/find-transparent-expression-root.js";
import { getDirectConstInitializer } from "../../utils/get-direct-const-initializer.js";
import { getFunctionBindingSymbols } from "../../utils/get-function-binding-symbols.js";
import { getDestructuredBindingPropertyName } from "../../utils/get-destructured-binding-property-name.js";
import { getJsxAttributeName } from "../../utils/get-jsx-attribute-name.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { isEffectCallbackReference } from "../../utils/is-effect-callback-reference.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isInsideTryStatement } from "../../utils/is-inside-try-statement.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isProvenGlobalNamespaceReference } from "../../utils/is-proven-global-namespace-reference.js";
import { isReactEffectHookCall } from "../../utils/is-react-effect-hook-call.js";
import { resolveConstIdentifierAlias } from "../../utils/resolve-const-identifier-alias.js";
import type { RuleContext } from "../../utils/rule-context.js";
import {
  TRANSPARENT_EXPRESSION_WRAPPER_TYPES,
  stripParenExpression,
} from "../../utils/strip-paren-expression.js";
import { resolveTanstackMutationHookNameFromInitializer } from "./utils/resolve-tanstack-query-hook-name.js";

const DISCARDING_SCHEDULER_NAMES = new Set([
  ...TIMER_AND_SCHEDULER_DIRECT_CALLEE_NAMES,
  "setImmediate",
]);

const PROMISE_REJECTION_FORWARDING_METHOD_NAMES = new Set(["all", "any", "race", "resolve"]);
const PROMISE_COLLECTION_METHOD_NAMES = new Set(["all", "any", "race"]);
const PROMISE_PRODUCING_COLLECTION_METHOD_NAMES = new Set(["flatMap", "map"]);

const isUseMutationInitializer = (initializer: EsTreeNode, context: RuleContext): boolean =>
  resolveTanstackMutationHookNameFromInitializer(initializer, context.scopes) === "useMutation";

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

const symbolComesFromMutateAsync = (
  symbol: SymbolDescriptor | null,
  context: RuleContext,
  visitedSymbolIds: Set<number> = new Set(),
): boolean => {
  if (!symbol || visitedSymbolIds.has(symbol.id)) return false;
  visitedSymbolIds.add(symbol.id);
  if (getDestructuredBindingPropertyName(symbol.bindingIdentifier) === "mutateAsync") {
    if (!symbol.initializer) return false;
    const initializer = stripParenExpression(symbol.initializer);
    if (isUseMutationInitializer(initializer, context)) return true;
    return (
      isNodeOfType(initializer, "Identifier") &&
      symbolComesFromUseMutationResult(context.scopes.symbolFor(initializer), context)
    );
  }
  const initializer = getDirectConstInitializer(symbol);
  if (!initializer) return false;
  const candidate = stripParenExpression(initializer);
  if (isNodeOfType(candidate, "Identifier")) {
    return symbolComesFromMutateAsync(
      context.scopes.symbolFor(candidate),
      context,
      visitedSymbolIds,
    );
  }
  if (!isNodeOfType(candidate, "MemberExpression")) return false;
  const resultObject = stripParenExpression(candidate.object);
  return (
    getStaticPropertyName(candidate) === "mutateAsync" &&
    isNodeOfType(resultObject, "Identifier") &&
    symbolComesFromUseMutationResult(context.scopes.symbolFor(resultObject), context)
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
  return symbolComesFromMutateAsync(context.scopes.symbolFor(callee), context);
};

const findFunctionSymbol = (
  functionNode: EsTreeNode,
  context: RuleContext,
): SymbolDescriptor | null => getFunctionBindingSymbols(functionNode, context.scopes)[0] ?? null;

const isEventHandlerAttributeValue = (expression: EsTreeNode): boolean => {
  const callbackValue = findCallbackSelectionRoot(expression);
  const container = callbackValue.parent;
  if (
    !isNodeOfType(container, "JSXExpressionContainer") ||
    container.expression !== callbackValue
  ) {
    return false;
  }
  const attribute = container.parent;
  if (!isNodeOfType(attribute, "JSXAttribute")) return false;
  const openingElement = attribute.parent;
  if (
    !isNodeOfType(openingElement, "JSXOpeningElement") ||
    !isNodeOfType(openingElement.name, "JSXIdentifier") ||
    !/^[a-z]/.test(openingElement.name.name)
  ) {
    return false;
  }
  const attributeName = getJsxAttributeName(attribute.name);
  return Boolean(attributeName && /^on[A-Z]/.test(attributeName));
};

const isDiscardingTestPosition = (expression: EsTreeNode, parent: EsTreeNode): boolean =>
  (isNodeOfType(parent, "UnaryExpression") && parent.argument === expression) ||
  (isNodeOfType(parent, "BinaryExpression") &&
    (parent.left === expression || parent.right === expression)) ||
  ((isNodeOfType(parent, "IfStatement") ||
    isNodeOfType(parent, "WhileStatement") ||
    isNodeOfType(parent, "DoWhileStatement") ||
    isNodeOfType(parent, "ForStatement")) &&
    parent.test === expression) ||
  (isNodeOfType(parent, "SwitchStatement") && parent.discriminant === expression);

const isSpreadArgument = (expression: EsTreeNode, parent: EsTreeNode): boolean =>
  isNodeOfType(parent, "SpreadElement") && parent.argument === expression;

const isExpressionValueDiscarded = (expression: EsTreeNode, context: RuleContext): boolean => {
  let current = expression;
  let parent = current.parent ?? null;
  while (parent) {
    if (
      TRANSPARENT_EXPRESSION_WRAPPER_TYPES.has(parent.type) ||
      isSpreadArgument(current, parent)
    ) {
      current = parent;
      parent = current.parent ?? null;
      continue;
    }
    if (isNodeOfType(parent, "ConditionalExpression")) {
      if (parent.test === current) return true;
      current = parent;
      parent = current.parent ?? null;
      continue;
    }
    if (isNodeOfType(parent, "LogicalExpression")) {
      if (parent.left === current && parent.operator === "&&") return true;
      current = parent;
      parent = current.parent ?? null;
      continue;
    }
    if (isDiscardingTestPosition(current, parent)) return true;
    if (isNodeOfType(parent, "SequenceExpression")) {
      if (parent.expressions.at(-1) !== current) return true;
      current = parent;
      parent = current.parent ?? null;
      continue;
    }
    const forwardingPromiseCall = getRejectionForwardingPromiseCall(current, parent, context);
    if (forwardingPromiseCall) {
      current = forwardingPromiseCall;
      parent = current.parent ?? null;
      continue;
    }
    return isNodeOfType(parent, "ExpressionStatement");
  }
  return false;
};

const isDiscardingCallbackHost = (
  callExpression: EsTreeNodeOfType<"CallExpression">,
  context: RuleContext,
): boolean => {
  if (isReactEffectHookCall(callExpression, context.scopes)) return true;
  const callee = stripParenExpression(callExpression.callee);
  if (isNodeOfType(callee, "Identifier")) {
    return (
      DISCARDING_SCHEDULER_NAMES.has(callee.name) &&
      isProvenGlobalNamespaceReference(callee, callee.name, context.scopes)
    );
  }
  if (!isNodeOfType(callee, "MemberExpression")) return false;
  const methodName = getStaticPropertyName(callee) ?? "";
  return (
    methodName === "forEach" ||
    (DISCARDING_SCHEDULER_NAMES.has(methodName) &&
      isProvenGlobalNamespaceReference(callee, methodName, context.scopes)) ||
    (PROMISE_PRODUCING_COLLECTION_METHOD_NAMES.has(methodName) &&
      isExpressionValueDiscarded(callExpression, context))
  );
};

const isDiscardedCallbackReference = (identifier: EsTreeNode, context: RuleContext): boolean => {
  if (
    isEventHandlerAttributeValue(identifier) ||
    isEffectCallbackReference(identifier, context.scopes)
  )
    return true;
  const callbackValue = findCallbackSelectionRoot(identifier);
  const callExpression = callbackValue.parent;
  return Boolean(
    isNodeOfType(callExpression, "CallExpression") &&
    callExpression.arguments.some((argument) => argument === callbackValue) &&
    isDiscardingCallbackHost(callExpression, context),
  );
};

const getPromiseMethodName = (
  callExpression: EsTreeNodeOfType<"CallExpression">,
  context: RuleContext,
): string | null => {
  const callee = stripParenExpression(callExpression.callee);
  if (!isNodeOfType(callee, "MemberExpression")) return null;
  const receiver = stripParenExpression(callee.object);
  if (!isProvenGlobalNamespaceReference(receiver, "Promise", context.scopes)) return null;
  return getStaticPropertyName(callee);
};

const getRejectionForwardingPromiseCall = (
  current: EsTreeNode,
  parent: EsTreeNode,
  context: RuleContext,
): EsTreeNodeOfType<"CallExpression"> | null => {
  if (
    isNodeOfType(parent, "CallExpression") &&
    parent.arguments.some((argument) => argument === current)
  ) {
    const methodName = getPromiseMethodName(parent, context);
    return methodName && PROMISE_REJECTION_FORWARDING_METHOD_NAMES.has(methodName) ? parent : null;
  }
  if (!isNodeOfType(parent, "ArrayExpression")) return null;
  const arrayRoot = findTransparentExpressionRoot(parent);
  const callExpression = arrayRoot.parent;
  if (
    !isNodeOfType(callExpression, "CallExpression") ||
    !callExpression.arguments.some((argument) => argument === arrayRoot)
  ) {
    return null;
  }
  const methodName = getPromiseMethodName(callExpression, context);
  return methodName && PROMISE_COLLECTION_METHOD_NAMES.has(methodName) ? callExpression : null;
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

const isFunctionResultDiscarded = (
  functionNode: EsTreeNode,
  context: RuleContext,
  visitedFunctions: Set<EsTreeNode>,
): boolean => {
  if (visitedFunctions.has(functionNode)) return false;
  const nextVisitedFunctions = new Set(visitedFunctions);
  nextVisitedFunctions.add(functionNode);
  if (isEventHandlerAttributeValue(functionNode)) return true;
  if (isEffectCallbackReference(functionNode, context.scopes)) return true;
  const callbackValue = findCallbackSelectionRoot(functionNode);
  const directParent = callbackValue.parent;
  if (
    isNodeOfType(directParent, "CallExpression") &&
    directParent.arguments.some((argument) => argument === callbackValue) &&
    isDiscardingCallbackHost(directParent, context)
  ) {
    return true;
  }
  const functionRoot = findTransparentExpressionRoot(functionNode);
  const immediateCall = functionRoot.parent;
  if (
    isNodeOfType(immediateCall, "CallExpression") &&
    stripParenExpression(immediateCall.callee) === functionNode
  ) {
    return isFloatingPromiseUse(immediateCall, context, nextVisitedFunctions);
  }
  const functionSymbol = findFunctionSymbol(functionNode, context);
  if (!functionSymbol) return false;
  return collectConstAliasSymbols(functionSymbol, context.scopes).some((symbol) =>
    symbol.references.some((reference) => {
      if (isDiscardedCallbackReference(reference.identifier, context)) return true;
      const referenceRoot = findTransparentExpressionRoot(reference.identifier);
      const caller = referenceRoot.parent;
      return Boolean(
        isNodeOfType(caller, "CallExpression") &&
        caller.callee === referenceRoot &&
        isFloatingPromiseUse(caller, context, new Set(nextVisitedFunctions)),
      );
    }),
  );
};

const isFloatingPromiseUse = (
  callExpression: EsTreeNodeOfType<"CallExpression">,
  context: RuleContext,
  visitedFunctions: Set<EsTreeNode> = new Set(),
): boolean => {
  let current: EsTreeNode = callExpression;
  let parent = current.parent ?? null;
  while (parent) {
    if (
      TRANSPARENT_EXPRESSION_WRAPPER_TYPES.has(parent.type) ||
      isSpreadArgument(current, parent)
    ) {
      current = parent;
      parent = current.parent ?? null;
      continue;
    }
    if (isNodeOfType(parent, "ConditionalExpression")) {
      if (parent.test === current) return true;
      current = parent;
      parent = current.parent ?? null;
      continue;
    }
    if (isNodeOfType(parent, "LogicalExpression")) {
      if (parent.left === current && parent.operator === "&&") return true;
      current = parent;
      parent = current.parent ?? null;
      continue;
    }
    if (isDiscardingTestPosition(current, parent)) return true;
    if (isNodeOfType(parent, "SequenceExpression")) {
      const finalExpression = parent.expressions.at(-1);
      if (finalExpression !== current) return true;
      current = parent;
      parent = current.parent ?? null;
      continue;
    }
    const forwardingPromiseCall = getRejectionForwardingPromiseCall(current, parent, context);
    if (forwardingPromiseCall) {
      current = forwardingPromiseCall;
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
      const memberRoot = findTransparentExpressionRoot(parent);
      const chainCall = memberRoot.parent;
      if (!isNodeOfType(chainCall, "CallExpression") || chainCall.callee !== memberRoot)
        return false;
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
    if (isNodeOfType(parent, "AwaitExpression") && parent.argument === current) {
      const awaitingFunction = findEnclosingFunction(parent);
      if (
        !awaitingFunction ||
        isInsideTryStatement(parent, {
          boundary: awaitingFunction,
          region: "block",
          requireHandler: true,
        })
      ) {
        return false;
      }
      return isFunctionResultDiscarded(awaitingFunction, context, visitedFunctions);
    }
    if (isNodeOfType(parent, "ExpressionStatement")) return true;
    let returningFunction: EsTreeNode | null = null;
    if (isNodeOfType(parent, "ReturnStatement") && parent.argument === current) {
      returningFunction = findEnclosingFunction(parent);
    } else if (isFunctionLike(parent) && parent.body === current) {
      returningFunction = parent;
    }
    if (returningFunction) {
      return isFunctionResultDiscarded(returningFunction, context, visitedFunctions);
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
