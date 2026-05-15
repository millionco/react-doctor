import { collectPatternNames } from "./collect-pattern-names.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { walkInsideStatementBlocks } from "./walk-inside-statement-blocks.js";

const isCookiesCall = (node: EsTreeNode): boolean =>
  isNodeOfType(node, "CallExpression") &&
  isNodeOfType(node.callee, "Identifier") &&
  node.callee.name === "cookies";

// `cookies()` became async in Next.js 15, so users now write
// `const cookieStore = await cookies()`. We unwrap one `await` so both
// the sync and async aliasing forms collapse to the same detection.
const isCookiesInit = (initNode: EsTreeNode): boolean => {
  if (isCookiesCall(initNode)) return true;
  if (isNodeOfType(initNode, "AwaitExpression") && initNode.argument) {
    return isCookiesCall(initNode.argument);
  }
  return false;
};

export const collectLocallyScopedCookieBindings = (handlerBody: EsTreeNode): Set<string> => {
  const cookieBindingNames = new Set<string>();
  walkInsideStatementBlocks(handlerBody, (node: EsTreeNode) => {
    if (!isNodeOfType(node, "VariableDeclarator")) return;
    if (!node.init) return;
    if (!isCookiesInit(node.init)) return;
    collectPatternNames(node.id, cookieBindingNames);
  });
  return cookieBindingNames;
};
