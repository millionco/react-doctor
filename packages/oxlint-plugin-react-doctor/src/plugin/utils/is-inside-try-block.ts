import type { EsTreeNode } from "./es-tree-node.js";
import { isFunctionLike } from "./is-function-like.js";
import { isNodeOfType } from "./is-node-of-type.js";

// True when `node` sits lexically inside the protected body (`try { … }`) of
// some `TryStatement` in the same function. The CFG deliberately models the
// exception path with a single coarse edge from the try ENTRY to the handler
// (see `CfgEdgeKind`), so a value written deeper in the try body — or in a
// nested `catch` within it — that is only read on the exceptional path (the
// enclosing `catch`/`finally`) is invisible to SSA liveness. Value-flow rules
// must treat such writes conservatively rather than report them as dead.
export const isInsideTryBlock = (node: EsTreeNode): boolean => {
  let child: EsTreeNode = node;
  let parent: EsTreeNode | null | undefined = node.parent;
  while (parent && !isFunctionLike(parent)) {
    if (isNodeOfType(parent, "TryStatement") && parent.block === child) return true;
    child = parent;
    parent = parent.parent ?? null;
  }
  return false;
};
