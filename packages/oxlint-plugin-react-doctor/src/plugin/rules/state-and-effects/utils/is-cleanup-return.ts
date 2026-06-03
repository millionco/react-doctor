import { TIMER_CLEANUP_CALLEE_NAMES } from "../../../constants/dom.js";
import {
  BOUND_RESOURCE_RELEASE_METHOD_NAMES,
  CLEANUP_LIKE_RELEASE_CALLEE_NAMES,
  GLOBAL_RELEASE_METHOD_NAMES,
} from "../../../constants/react.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isFunctionLike } from "../../../utils/is-function-like.js";
import { walkAst } from "../../../utils/walk-ast.js";
import {
  isCleanupReturningSubscribeLikeCallExpression,
  isSubscribeLikeCallExpression,
} from "./is-subscribe-like-call-expression.js";

interface CleanupReturnOptions {
  readonly allowOpaqueReturn?: boolean;
}

const ITERATOR_CALLBACK_METHOD_NAMES = new Set([
  "each",
  "every",
  "filter",
  "find",
  "findIndex",
  "findLast",
  "findLastIndex",
  "flatMap",
  "forEach",
  "map",
  "reduce",
  "reduceRight",
  "some",
  "sort",
  "toSorted",
]);

const STATIC_ITERATOR_CALLBACK_METHOD_NAMES = new Set(["from", "fromAsync", "groupBy"]);

const unwrapChainExpression = (node: EsTreeNode): EsTreeNode =>
  isNodeOfType(node, "ChainExpression") ? node.expression : node;

const isNullLiteral = (node: EsTreeNode | null | undefined): boolean =>
  isNodeOfType(node, "Literal") && node.value === null;

const isListenerRemovalViaNullHandler = (callNode: EsTreeNode): boolean => {
  if (!isNodeOfType(callNode, "CallExpression")) return false;
  const callee = unwrapChainExpression(callNode.callee);
  // d3-style `.on(name, null)` removes a listener.
  return (
    isNodeOfType(callee, "MemberExpression") &&
    isNodeOfType(callee.property, "Identifier") &&
    callee.property.name === "on" &&
    isNullLiteral(callNode.arguments?.[1])
  );
};

const isReleaseLikeCall = (
  node: EsTreeNode,
  knownCleanupFunctionNames: ReadonlySet<string>,
  knownBoundSubscriptionNames: ReadonlySet<string>,
): boolean => {
  const callNode = unwrapChainExpression(node);
  if (!isNodeOfType(callNode, "CallExpression")) return false;
  if (isListenerRemovalViaNullHandler(callNode)) return true;
  const callee = unwrapChainExpression(callNode.callee);
  if (isNodeOfType(callee, "Identifier")) {
    if (TIMER_CLEANUP_CALLEE_NAMES.has(callee.name)) return true;
    if (CLEANUP_LIKE_RELEASE_CALLEE_NAMES.has(callee.name)) return true;
    if (knownCleanupFunctionNames.has(callee.name)) return true;
    return false;
  }
  if (isNodeOfType(callee, "MemberExpression") && isNodeOfType(callee.property, "Identifier")) {
    if (
      BOUND_RESOURCE_RELEASE_METHOD_NAMES.has(callee.property.name) &&
      // Generic release verbs need a known subscription receiver.
      // TODO(v2 - receiver analysis): handle `subRef.current.remove()`.
      isNodeOfType(callee.object, "Identifier") &&
      knownBoundSubscriptionNames.has(callee.object.name)
    ) {
      return true;
    }
    return GLOBAL_RELEASE_METHOD_NAMES.has(callee.property.name);
  }
  return false;
};

const isStaticIteratorCallbackCallee = (callee: EsTreeNode): boolean =>
  isNodeOfType(callee, "MemberExpression") &&
  isNodeOfType(callee.object, "Identifier") &&
  isNodeOfType(callee.property, "Identifier") &&
  (callee.object.name === "Array" ||
    callee.object.name === "Map" ||
    callee.object.name === "Object") &&
  STATIC_ITERATOR_CALLBACK_METHOD_NAMES.has(callee.property.name);

const isIteratorCallbackArgument = (node: EsTreeNode): boolean => {
  const parentNode = node.parent;
  if (!isNodeOfType(parentNode, "CallExpression")) return false;
  if (!parentNode.arguments?.some((argument) => argument === node)) return false;
  const callee = unwrapChainExpression(parentNode.callee);
  if (parentNode.arguments[1] === node && isStaticIteratorCallbackCallee(callee)) return true;
  return (
    isNodeOfType(callee, "MemberExpression") &&
    isNodeOfType(callee.property, "Identifier") &&
    ITERATOR_CALLBACK_METHOD_NAMES.has(callee.property.name)
  );
};

const containsReleaseLikeCall = (
  node: EsTreeNode,
  knownCleanupFunctionNames: ReadonlySet<string>,
  knownBoundSubscriptionNames: ReadonlySet<string>,
): boolean => {
  let didFindRelease = false;
  walkAst(node, (child: EsTreeNode) => {
    if (didFindRelease) return false;
    if (child !== node && isFunctionLike(child) && !isIteratorCallbackArgument(child)) {
      return false;
    }
    if (isReleaseLikeCall(child, knownCleanupFunctionNames, knownBoundSubscriptionNames)) {
      didFindRelease = true;
      return false;
    }
  });
  return didFindRelease;
};

export const isCleanupFunctionLike = (
  node: EsTreeNode,
  knownCleanupFunctionNames: ReadonlySet<string>,
  knownBoundSubscriptionNames: ReadonlySet<string>,
): boolean => {
  if (!isFunctionLike(node)) return false;
  return containsReleaseLikeCall(node.body, knownCleanupFunctionNames, knownBoundSubscriptionNames);
};

export const isCleanupReturn = (
  returnedValue: EsTreeNode | null | undefined,
  knownCleanupFunctionNames: ReadonlySet<string>,
  knownBoundSubscriptionNames: ReadonlySet<string>,
  options: CleanupReturnOptions = {},
): boolean => {
  if (!returnedValue) return false;
  const unwrappedValue = unwrapChainExpression(returnedValue);
  if (isNodeOfType(unwrappedValue, "Literal") && unwrappedValue.value === null) {
    return false;
  }
  if (isNodeOfType(unwrappedValue, "Identifier")) {
    if (unwrappedValue.name === "undefined") return false;
    if (knownCleanupFunctionNames.has(unwrappedValue.name)) return true;
    return (
      options.allowOpaqueReturn === true && !knownBoundSubscriptionNames.has(unwrappedValue.name)
    );
  }
  if (isCleanupReturningSubscribeLikeCallExpression(unwrappedValue)) return true;
  if (options.allowOpaqueReturn === true && !isSubscribeLikeCallExpression(unwrappedValue)) {
    return true;
  }
  if (
    isCleanupFunctionLike(unwrappedValue, knownCleanupFunctionNames, knownBoundSubscriptionNames)
  ) {
    return true;
  }
  return false;
};
