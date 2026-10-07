import type { EsTreeNode } from "./es-tree-node.js";

const CONDITIONAL_EXECUTION_NODE_TYPES: ReadonlySet<string> = new Set([
  "CatchClause",
  "ConditionalExpression",
  "DoWhileStatement",
  "ForInStatement",
  "ForOfStatement",
  "ForStatement",
  "IfStatement",
  "LogicalExpression",
  "SwitchCase",
  "SwitchStatement",
  "TryStatement",
  "WhileStatement",
]);

export const isNodeOnUnconditionalPath = (node: EsTreeNode, boundary: EsTreeNode): boolean => {
  let current = node.parent ?? null;
  while (current && current !== boundary) {
    if (CONDITIONAL_EXECUTION_NODE_TYPES.has(current.type)) return false;
    current = current.parent ?? null;
  }
  return current === boundary;
};
