import type { EsTreeNode } from "./es-tree-node.js";
import type { NodeWithOptionalType } from "./node-with-optional-type.js";

export const isAstNode = (value: unknown): value is EsTreeNode =>
  value !== null &&
  typeof value === "object" &&
  typeof (value as NodeWithOptionalType).type === "string";
