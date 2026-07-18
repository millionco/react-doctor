import type { EsTreeNode } from "./es-tree-node.js";
import { isNodeOfType } from "./is-node-of-type.js";

export const unwrapReturnExpression = (node: EsTreeNode): EsTreeNode =>
  isNodeOfType(node, "ReturnStatement") && node.argument ? node.argument : node;
