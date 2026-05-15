import type { EsTreeNode } from "./es-tree-node.js";

export interface ComponentBindingStackTrackerCallbacks {
  onVariableDeclarator?: (node: EsTreeNode) => void;
}
