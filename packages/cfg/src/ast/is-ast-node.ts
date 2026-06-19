import type { EsTreeNode } from "./es-tree-node.js";
import { hasTypeProperty } from "./has-type-property.js";

export const isAstNode = (value: unknown): value is EsTreeNode => {
  if (!hasTypeProperty(value)) return false;
  return typeof value.type === "string";
};
