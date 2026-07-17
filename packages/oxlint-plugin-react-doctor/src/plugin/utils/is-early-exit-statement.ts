import type { EsTreeNode } from "./es-tree-node.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { statementAlwaysExits } from "./statement-always-exits.js";

export const isEarlyExitStatement = (statement: EsTreeNode | null | undefined): boolean => {
  if (!statement) return false;
  if (statementAlwaysExits(statement)) return true;
  if (isNodeOfType(statement, "BlockStatement")) {
    return isEarlyExitStatement(statement.body.at(-1));
  }
  return isNodeOfType(statement, "ContinueStatement") || isNodeOfType(statement, "BreakStatement");
};
