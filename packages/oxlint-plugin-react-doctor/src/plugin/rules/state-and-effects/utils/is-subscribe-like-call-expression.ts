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
  return methodName !== null && CLEANUP_RETURNING_SUBSCRIPTION_METHOD_NAMES.has(methodName);
};
