import { isNodeOfType } from "./is-node-of-type.js";
import type { EsTreeNode } from "./es-tree-node.js";

export const statementAlwaysExits = (statement: EsTreeNode): boolean => {
  if (isNodeOfType(statement, "ReturnStatement") || isNodeOfType(statement, "ThrowStatement")) {
    return true;
  }
  if (isNodeOfType(statement, "IfStatement")) {
    if (isNodeOfType(statement.test, "Literal")) {
      const reachableBranch = statement.test.value ? statement.consequent : statement.alternate;
      return reachableBranch ? statementAlwaysExits(reachableBranch) : false;
    }
    return Boolean(
      statement.alternate &&
      statementAlwaysExits(statement.consequent) &&
      statementAlwaysExits(statement.alternate),
    );
  }
  if (isNodeOfType(statement, "TryStatement")) {
    if (statement.finalizer && statementAlwaysExits(statement.finalizer)) return true;
    if (!statementAlwaysExits(statement.block)) return false;
    return statement.handler ? statementAlwaysExits(statement.handler.body) : true;
  }
  if (isNodeOfType(statement, "DoWhileStatement")) {
    return statementAlwaysExits(statement.body);
  }
  if (isNodeOfType(statement, "WhileStatement")) {
    const whileStatementTest: EsTreeNode = statement.test;
    return Boolean(
      isNodeOfType(whileStatementTest, "Literal") &&
      whileStatementTest.value &&
      statementAlwaysExits(statement.body),
    );
  }
  if (isNodeOfType(statement, "ForStatement")) {
    const forStatementTest: EsTreeNode | null = statement.test;
    return Boolean(
      (!forStatementTest ||
        (isNodeOfType(forStatementTest, "Literal") && forStatementTest.value)) &&
      statementAlwaysExits(statement.body),
    );
  }
  if (!isNodeOfType(statement, "BlockStatement")) return false;
  return statement.body.some((childStatement) => statementAlwaysExits(childStatement));
};
