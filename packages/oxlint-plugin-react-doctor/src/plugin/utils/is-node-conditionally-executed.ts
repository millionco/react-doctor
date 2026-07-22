import type { EsTreeNode } from "./es-tree-node.js";
import { getConditionalExecutionRegions } from "./get-conditional-execution-regions.js";

export const isNodeConditionallyExecuted = (node: EsTreeNode, boundary: EsTreeNode): boolean =>
  getConditionalExecutionRegions(node, boundary).size > 0;
