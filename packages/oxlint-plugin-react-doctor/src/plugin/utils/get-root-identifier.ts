import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { stripParenExpression } from "./strip-paren-expression.js";

export interface RootIdentifierOptions {
  followCallChains?: boolean;
}

export const getRootIdentifier = (
  node: EsTreeNode | undefined | null,
  options?: RootIdentifierOptions,
): EsTreeNodeOfType<"Identifier"> | null => {
  if (!node) return null;
  const followCallChains = options?.followCallChains === true;
  let cursor: EsTreeNode | undefined = node;
  while (cursor) {
    cursor = stripParenExpression(cursor);
    if (isNodeOfType(cursor, "MemberExpression")) {
      cursor = cursor.object;
      continue;
    }
    if (followCallChains && isNodeOfType(cursor, "CallExpression")) {
      if (!isNodeOfType(cursor.callee, "MemberExpression")) return null;
      cursor = cursor.callee.object;
      continue;
    }
    break;
  }
  return isNodeOfType(cursor, "Identifier") ? cursor : null;
};
