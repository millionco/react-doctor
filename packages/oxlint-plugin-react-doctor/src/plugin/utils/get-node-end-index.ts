import type { EsTreeNode } from "./es-tree-node.js";

export const getNodeEndIndex = (node: EsTreeNode): number =>
  "end" in node && typeof node.end === "number" ? node.end : -1;
