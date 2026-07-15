import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { readServerSnapshotBoolean } from "./read-server-snapshot-boolean.js";

export const isGatedByFalsyServerSnapshot = (
  node: EsTreeNode,
  scopes: ScopeAnalysis,
  filename?: string,
): boolean => {
  let currentNode: EsTreeNode = node;
  let parentNode: EsTreeNode | null | undefined = node.parent;
  while (parentNode) {
    if (
      isNodeOfType(parentNode, "LogicalExpression") &&
      parentNode.right === currentNode &&
      ((parentNode.operator === "&&" &&
        readServerSnapshotBoolean(parentNode.left, scopes, filename) === false) ||
        (parentNode.operator === "||" &&
          readServerSnapshotBoolean(parentNode.left, scopes, filename) === true))
    ) {
      return true;
    }
    if (
      isNodeOfType(parentNode, "ConditionalExpression") &&
      ((parentNode.consequent === currentNode &&
        readServerSnapshotBoolean(parentNode.test, scopes, filename) === false) ||
        (parentNode.alternate === currentNode &&
          readServerSnapshotBoolean(parentNode.test, scopes, filename) === true))
    ) {
      return true;
    }
    if (
      isNodeOfType(parentNode, "IfStatement") &&
      ((parentNode.consequent === currentNode &&
        readServerSnapshotBoolean(parentNode.test, scopes, filename) === false) ||
        (parentNode.alternate === currentNode &&
          readServerSnapshotBoolean(parentNode.test, scopes, filename) === true))
    ) {
      return true;
    }
    currentNode = parentNode;
    parentNode = parentNode.parent ?? null;
  }
  return false;
};
