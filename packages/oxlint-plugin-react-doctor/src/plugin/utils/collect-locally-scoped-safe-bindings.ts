import { collectPatternNames } from "./collect-pattern-names.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isSafeMutableReceiverSource } from "./is-safe-mutable-receiver-source.js";
import { walkInsideStatementBlocks } from "./walk-inside-statement-blocks.js";

export const collectLocallyScopedSafeBindings = (handlerBody: EsTreeNode): Set<string> => {
  const safeBindingNames = new Set<string>();
  walkInsideStatementBlocks(handlerBody, (node: EsTreeNode) => {
    if (!isNodeOfType(node, "VariableDeclarator")) return;
    if (!node.init) return;
    if (!isSafeMutableReceiverSource(node.init)) return;
    collectPatternNames(node.id, safeBindingNames);
  });
  return safeBindingNames;
};
