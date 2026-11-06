import type { EsTreeNode } from "./es-tree-node.js";
import { isNodeOfType } from "./is-node-of-type.js";

export const isPrimitiveLiteral = (node: EsTreeNode): boolean =>
  isNodeOfType(node, "Literal") &&
  !("regex" in node) &&
  (node.value === null || typeof node.value !== "object");
