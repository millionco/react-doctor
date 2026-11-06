import type { EsTreeNode } from "./es-tree-node.js";

export interface ReportDescriptor {
  node: EsTreeNode;
  contextNodes?: ReadonlyArray<EsTreeNode>;
  message: string;
}
