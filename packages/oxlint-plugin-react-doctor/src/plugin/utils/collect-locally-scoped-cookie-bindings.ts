import { collectPatternNames } from "./collect-pattern-names.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { isCookiesOrAwaitedCookiesCall } from "./is-cookies-or-awaited-cookies-call.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { walkInsideStatementBlocks } from "./walk-inside-statement-blocks.js";

export const collectLocallyScopedCookieBindings = (handlerBody: EsTreeNode): Set<string> => {
  const cookieBindingNames = new Set<string>();
  walkInsideStatementBlocks(handlerBody, (node: EsTreeNode) => {
    if (!isNodeOfType(node, "VariableDeclarator")) return;
    if (!node.init) return;
    if (!isCookiesOrAwaitedCookiesCall(node.init)) return;
    collectPatternNames(node.id, cookieBindingNames);
  });
  return cookieBindingNames;
};
