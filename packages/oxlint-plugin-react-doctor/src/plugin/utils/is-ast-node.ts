import type { EsTreeNode } from "./es-tree-node.js";

export const isAstNode = (value: unknown): value is EsTreeNode =>
  value !== null && typeof value === "object" && "type" in value && typeof value.type === "string";
