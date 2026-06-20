import type { EsTreeNode } from "./es-tree-node.js";

// oxc's `parseSync` emits ESTree byte offsets as `start` / `end` and never
// populates `range`, which TSESTree's types don't declare — so read the
// offset structurally. Returns -1 when the node carries no usable offset.
export const nodeStart = (node: EsTreeNode): number =>
  "start" in node && typeof node.start === "number" ? node.start : -1;
