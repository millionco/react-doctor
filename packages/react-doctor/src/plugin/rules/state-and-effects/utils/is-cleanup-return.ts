import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { containsReleaseLikeCall } from "./contains-release-like-call.js";
import { isSubscribeLikeCallExpression } from "./is-subscribe-like-call-expression.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";

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
