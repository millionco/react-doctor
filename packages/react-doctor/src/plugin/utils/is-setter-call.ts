import type { EsTreeNode } from "./es-tree-node.js";
import { isSetterIdentifier } from "./is-setter-identifier.js";
import { isNodeOfType } from "./is-node-of-type.js";

export const isSetterCall = (node: EsTreeNode): boolean =>
  isNodeOfType(node, "CallExpression") &&
  isNodeOfType(node.callee, "Identifier") &&
  isSetterIdentifier(node.callee.name);
