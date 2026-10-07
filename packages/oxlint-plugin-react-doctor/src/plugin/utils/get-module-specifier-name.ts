import type { EsTreeNode } from "./es-tree-node.js";
import { isNodeOfType } from "./is-node-of-type.js";

export const getModuleSpecifierName = (node: EsTreeNode | null | undefined): string | null => {
  if (isNodeOfType(node, "Identifier")) return node.name;
  return isNodeOfType(node, "Literal") && typeof node.value === "string" ? node.value : null;
};
