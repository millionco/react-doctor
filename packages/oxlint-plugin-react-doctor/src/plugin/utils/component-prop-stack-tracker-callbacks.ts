import type { EsTreeNode } from "./es-tree-node.js";

export interface ComponentPropStackTrackerCallbacks {
  onComponentEnter?: (componentBody: EsTreeNode | undefined) => void;
}
