import type { EsTreeNode } from "./es-tree-node.js";
import { isNodeOfType } from "./is-node-of-type.js";

/**
 * Returns the static method name of a call's callee when it's a
 * non-computed MemberExpression (`obj.method` → `"method"`), or
 * `null` otherwise. Used by `no-pass-data-to-parent` and
 * `no-pass-live-state-to-parent` to match the receiver-bound
 * method-call shape against an allow/block list.
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
