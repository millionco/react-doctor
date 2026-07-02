import {
  CLEANUP_RETURNING_SUBSCRIPTION_METHOD_NAMES,
  SUBSCRIPTION_METHOD_NAMES,
} from "../../../constants/react.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";

const getSubscribeLikeMethodName = (node: EsTreeNode): string | null => {
  if (!isNodeOfType(node, "CallExpression")) return null;
  if (!isNodeOfType(node.callee, "MemberExpression")) return null;
  if (!isNodeOfType(node.callee.property, "Identifier")) return null;
  return node.callee.property.name;
};

export const isSubscribeLikeCallExpression = (node: EsTreeNode): boolean => {
  const methodName = getSubscribeLikeMethodName(node);
  return methodName !== null && SUBSCRIPTION_METHOD_NAMES.has(methodName);
};

export const isCleanupReturningSubscribeLikeCallExpression = (node: EsTreeNode): boolean => {
  const methodName = getSubscribeLikeMethodName(node);
  if (methodName === null || !CLEANUP_RETURNING_SUBSCRIPTION_METHOD_NAMES.has(methodName)) {
    return false;
  }
  // `listen` is only disposer-returning in the store-subscription shape
  // (`store.listen(cb)` — nanostores et al.). Node's `server.listen(3000)`
  // returns the server itself, so returning that handle closes nothing;
  // require an inline callback argument before trusting the contract.
  if (methodName === "listen") {
    const callArguments = isNodeOfType(node, "CallExpression") ? (node.arguments ?? []) : [];
    return callArguments.some(
      (argument) =>
        isNodeOfType(argument, "ArrowFunctionExpression") ||
        isNodeOfType(argument, "FunctionExpression"),
    );
  }
  return true;
};
