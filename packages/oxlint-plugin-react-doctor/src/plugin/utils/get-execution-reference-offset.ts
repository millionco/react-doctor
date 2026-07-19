import type { EsTreeNode } from "./es-tree-node.js";
import { isNodeOfType } from "./is-node-of-type.js";

export const getExecutionReferenceOffset = (referenceNode: EsTreeNode): number =>
  isNodeOfType(referenceNode, "Program") ? referenceNode.range[1] : referenceNode.range[0];
