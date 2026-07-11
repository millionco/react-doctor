import { isNodeOfType } from "./is-node-of-type.js";
import type { EsTreeNode } from "./es-tree-node.js";

export const statementAlwaysExits = (statement: EsTreeNode): boolean => {
  if (isNodeOfType(statement, "ReturnStatement") || isNodeOfType(statement, "ThrowStatement")) {
    return true;
  }
  if (isNodeOfType(statement, "IfStatement")) {
    return Boolean(
      statement.alternate &&
      statementAlwaysExits(statement.consequent) &&
      statementAlwaysExits(statement.alternate),
    );
  }
  if (!isNodeOfType(statement, "BlockStatement")) return false;
  return statement.body.some((childStatement) => statementAlwaysExits(childStatement));
};
