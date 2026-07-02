import type { EsTreeNode } from "./es-tree-node.js";
import { isNodeOfType } from "./is-node-of-type.js";

// True when `node` is the object a member access reads through — i.e.
// `<node>.foo` / `<node>[k]`. Detects "this value is immediately
// dereferenced" (e.g. a `!` assertion whose result is read straight through).
export const isObjectOfMemberAccess = (node: EsTreeNode): boolean => {
  const parent = node.parent;
  return Boolean(parent && isNodeOfType(parent, "MemberExpression") && parent.object === node);
};
