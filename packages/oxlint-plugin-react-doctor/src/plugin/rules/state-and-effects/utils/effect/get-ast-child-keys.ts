import { visitorKeys } from "oxc-parser";
import type { EsTreeNode } from "../../../../utils/es-tree-node.js";

export const getAstChildKeys = (node: EsTreeNode): string[] =>
  visitorKeys[node.type] ?? Object.keys(node).filter((key) => key !== "parent");
