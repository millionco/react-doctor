import type { EsTreeNode } from "./es-tree-node.js";

export const getNodeStartIndex = (node: EsTreeNode): number =>
  "start" in node && typeof node.start === "number" ? node.start : -1;
