import type { EsTreeNode } from "./es-tree-node.js";
import { isUppercaseName } from "./is-uppercase-name.js";
import { isNodeOfType } from "./is-node-of-type.js";

export const isComponentDeclaration = (node: EsTreeNode): boolean =>
  isNodeOfType(node, "FunctionDeclaration") &&
  node.id !== null &&
  Boolean(node.id?.name) &&
  isUppercaseName(node.id.name);
