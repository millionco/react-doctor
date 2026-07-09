import type { EsTreeNode } from "./es-tree-node.js";

export const getRangeStart = (node: EsTreeNode): number | null => {
  const rangeStart = node.range?.[0];
  return typeof rangeStart === "number" ? rangeStart : null;
};
