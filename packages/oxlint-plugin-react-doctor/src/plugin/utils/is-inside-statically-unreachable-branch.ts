import type { EsTreeNode } from "./es-tree-node.js";
import { isNodeOfType } from "./is-node-of-type.js";

export interface StaticUnreachableBranchOptions {
  executionBoundary?: EsTreeNode | null;
  readLiteralTruthiness?: (node: EsTreeNode) => boolean | null;
}

export const isInsideStaticallyUnreachableBranch = (
  node: EsTreeNode,
  options?: StaticUnreachableBranchOptions,
): boolean => {
  const executionBoundary = options?.executionBoundary;
  const readLiteralTruthiness = options?.readLiteralTruthiness;
  let child = node;
  let parent = node.parent;
  while (parent && parent !== executionBoundary) {
    if (isNodeOfType(parent, "IfStatement") && isNodeOfType(parent.test, "Literal")) {
      if (
        (readLiteralTruthiness
          ? readLiteralTruthiness(parent.test) === false
          : parent.test.value === false) &&
        parent.consequent === child
      )
        return true;
      if (
        (readLiteralTruthiness
          ? readLiteralTruthiness(parent.test) === true
          : parent.test.value === true) &&
        parent.alternate === child
      )
        return true;
    }
    if (isNodeOfType(parent, "ConditionalExpression") && isNodeOfType(parent.test, "Literal")) {
      if (
        (readLiteralTruthiness
          ? readLiteralTruthiness(parent.test) === false
          : parent.test.value === false) &&
        parent.consequent === child
      )
        return true;
      if (
        (readLiteralTruthiness
          ? readLiteralTruthiness(parent.test) === true
          : parent.test.value === true) &&
        parent.alternate === child
      )
        return true;
    }
    if (
      (isNodeOfType(parent, "WhileStatement") || isNodeOfType(parent, "ForStatement")) &&
      parent.body === child &&
      parent.test &&
      isNodeOfType(parent.test, "Literal") &&
      (readLiteralTruthiness ? readLiteralTruthiness(parent.test) === false : !parent.test.value)
    ) {
      return true;
    }
    if (isNodeOfType(parent, "LogicalExpression") && parent.right === child) {
      if (
        isNodeOfType(parent.left, "Literal") &&
        ((parent.operator === "&&" &&
          (readLiteralTruthiness
            ? readLiteralTruthiness(parent.left) === false
            : !parent.left.value)) ||
          (parent.operator === "||" &&
            (readLiteralTruthiness
              ? readLiteralTruthiness(parent.left) === true
              : Boolean(parent.left.value))))
      ) {
        return true;
      }
    }
    child = parent;
    parent = parent.parent;
  }
  return false;
};
