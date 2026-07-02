import type { EsTreeNode } from "./es-tree-node.js";
import { isNodeOfType } from "./is-node-of-type.js";

/**
 * Returns the static method name of a call's callee when it's a
 * non-computed MemberExpression (`obj.method` → `"method"`), or
 * `null` otherwise.
 */
export const getCallMethodName = (callee: EsTreeNode): string | null => {
  if (
    isNodeOfType(callee, "MemberExpression") &&
    !callee.computed &&
    isNodeOfType(callee.property, "Identifier")
  ) {
    return callee.property.name;
  }
  return null;
};
