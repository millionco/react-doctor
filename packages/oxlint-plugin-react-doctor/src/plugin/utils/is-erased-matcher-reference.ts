import type { EsTreeNode } from "./es-tree-node.js";
import { isTypeScriptTypePosition } from "./is-typescript-type-position.js";

export const isErasedMatcherReference = (node: EsTreeNode): boolean => {
  if (isTypeScriptTypePosition(node)) return true;
  let ancestor = node.parent;
  while (ancestor) {
    if (
      ancestor.type === "TSDeclareFunction" ||
      ("declare" in ancestor && ancestor.declare === true)
    )
      return true;
    ancestor = ancestor.parent;
  }
  return false;
};
