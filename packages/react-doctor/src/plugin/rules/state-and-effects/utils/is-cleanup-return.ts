import { TIMER_CLEANUP_CALLEE_NAMES } from "../../../constants/dom.js";
import {
  CLEANUP_LIKE_RELEASE_CALLEE_NAMES,
  UNSUBSCRIPTION_METHOD_NAMES,
} from "../../../constants/react.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { walkAst } from "../../../utils/walk-ast.js";
import { isSubscribeLikeCallExpression } from "./is-subscribe-like-call-expression.js";

const isReleaseLikeCall = (
  callNode: EsTreeNode,
  knownBoundReleaseNames: ReadonlySet<string>,
): boolean => {
  if (!isNodeOfType(callNode, "CallExpression")) return false;
  const callee = callNode.callee;
  if (isNodeOfType(callee, "Identifier")) {
    if (TIMER_CLEANUP_CALLEE_NAMES.has(callee.name)) return true;
    if (CLEANUP_LIKE_RELEASE_CALLEE_NAMES.has(callee.name)) return true;
    if (knownBoundReleaseNames.has(callee.name)) return true;
    return false;
  }
  if (isNodeOfType(callee, "MemberExpression") && isNodeOfType(callee.property, "Identifier")) {
    return UNSUBSCRIPTION_METHOD_NAMES.has(callee.property.name);
  }
  return false;
};

const containsReleaseLikeCall = (
  node: EsTreeNode,
  knownBoundReleaseNames: ReadonlySet<string>,
): boolean => {
  let didFindRelease = false;
  walkAst(node, (child: EsTreeNode) => {
    if (didFindRelease) return false;
    if (isReleaseLikeCall(child, knownBoundReleaseNames)) {
      didFindRelease = true;
      return false;
    }
  });
  return didFindRelease;
};

export const isCleanupReturn = (
  returnedValue: EsTreeNode | null | undefined,
  knownBoundReleaseNames: ReadonlySet<string>,
): boolean => {
  if (!returnedValue) return false;
  if (isNodeOfType(returnedValue, "Identifier")) {
    return knownBoundReleaseNames.has(returnedValue.name);
  }
  if (isSubscribeLikeCallExpression(returnedValue)) return true;
  if (
    isNodeOfType(returnedValue, "ArrowFunctionExpression") ||
    isNodeOfType(returnedValue, "FunctionExpression")
  ) {
    return containsReleaseLikeCall(returnedValue, knownBoundReleaseNames);
  }
  return false;
};
