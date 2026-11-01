import { isNodeOfType } from "./is-node-of-type.js";
import { isNoOpExpression } from "./is-no-op-expression.js";
import type { EsTreeNode } from "./es-tree-node.js";

// `void 0;`, a bare literal (including "use client"-style directives), and
// `;` execute nothing observable. Rules whose contract is "the body
// contains ONLY setState calls" must skip these instead of letting a no-op
// statement silence detection.
export const isNoOpStatement = (statement: EsTreeNode): boolean =>
  isNodeOfType(statement, "EmptyStatement") ||
  (isNodeOfType(statement, "ExpressionStatement") && isNoOpExpression(statement.expression));
