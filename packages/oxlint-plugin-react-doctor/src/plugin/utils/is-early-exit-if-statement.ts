import type { EsTreeNode } from "./es-tree-node.js";
import { isNodeOfType } from "./is-node-of-type.js";

const isEarlyExitStatement = (statement: EsTreeNode): boolean =>
  isNodeOfType(statement, "ReturnStatement") ||
  isNodeOfType(statement, "ThrowStatement") ||
  isNodeOfType(statement, "ContinueStatement") ||
  isNodeOfType(statement, "BreakStatement");

// Recognises `if (cond) return …;`, `if (cond) throw …;`, and the loop
// equivalents `continue` / `break`. The consequent may be the exit itself
// or a block whose first statement is the exit (matching the original
// rule's heuristic, ignoring any unreachable tail).
export const isEarlyExitIfStatement = (statement: EsTreeNode): boolean => {
  if (!isNodeOfType(statement, "IfStatement")) return false;
  const consequent = statement.consequent;
  if (!consequent) return false;
  if (isEarlyExitStatement(consequent)) return true;
  if (!isNodeOfType(consequent, "BlockStatement")) return false;
  for (const inner of consequent.body ?? []) {
    if (isEarlyExitStatement(inner)) return true;
  }
  return false;
};
