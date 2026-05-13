import type { EsTreeNode } from "./es-tree-node.js";
import { isNodeOfType } from "./is-node-of-type.js";

export const isMemberProperty = (node: EsTreeNode, propertyName: string): boolean =>
  isNodeOfType(node, "MemberExpression") &&
  isNodeOfType(node.property, "Identifier") &&
  node.property.name === propertyName;
