import type { EsTreeNode } from "./es-tree-node.js";

export interface ReportDescriptor {
  node: EsTreeNode;
  message: string;
}
