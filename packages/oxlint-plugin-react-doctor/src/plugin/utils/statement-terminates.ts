import type { EsTreeNode } from "./es-tree-node.js";
import { isNodeOfType } from "./is-node-of-type.js";

export const statementTerminates = (statement: EsTreeNode): boolean => {
  if (isNodeOfType(statement, "ReturnStatement") || isNodeOfType(statement, "ThrowStatement")) {
    return true;
  }
  if (!isNodeOfType(statement, "BlockStatement")) return false;
  const lastStatement = statement.body.at(-1);
  return Boolean(lastStatement && statementTerminates(lastStatement));
};
