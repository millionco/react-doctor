import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";

export const unwrapChainExpression = (node: EsTreeNode | null | undefined): EsTreeNode | null =>
  isNodeOfType(node, "ChainExpression") ? node.expression : (node ?? null);
