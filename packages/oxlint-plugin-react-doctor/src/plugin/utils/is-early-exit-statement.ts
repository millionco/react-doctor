import type { EsTreeNode } from "./es-tree-node.js";
import { isNodeOfType } from "./is-node-of-type.js";

// A statement that unconditionally leaves the enclosing flow — or a block
// whose final statement does.
export const isEarlyExitStatement = (statement: EsTreeNode | null | undefined): boolean => {
  if (!statement) return false;
  if (isNodeOfType(statement, "BlockStatement")) {
    return isEarlyExitStatement(statement.body.at(-1));
  }
  return (
    isNodeOfType(statement, "ReturnStatement") ||
    isNodeOfType(statement, "ThrowStatement") ||
    isNodeOfType(statement, "ContinueStatement") ||
    isNodeOfType(statement, "BreakStatement")
  );
};
