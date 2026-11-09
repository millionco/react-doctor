import type { EsTreeNode } from "./es-tree-node.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { stripParenExpression } from "./strip-paren-expression.js";
import {
  CLOSED_JSON_SNAPSHOT_INACTIVE_BRANCH_MAX_DEPTH,
  CLOSED_JSON_SNAPSHOT_INACTIVE_EXPRESSION_MAX_DEPTH,
  CLOSED_JSON_SNAPSHOT_INACTIVE_EXPRESSION_MAX_STEPS,
} from "./closed-json-snapshot-inactive-branch/constants.js";

interface SnapshotBranchBudget {
  remainingSteps: number;
}

interface SnapshotBranchPrimitive {
  readonly value: string | number | boolean | null;
}

const readSnapshotPrimitive = (
  expression: EsTreeNode,
  depth: number,
  budget: SnapshotBranchBudget,
): SnapshotBranchPrimitive | null => {
  budget.remainingSteps -= 1;
  if (depth > CLOSED_JSON_SNAPSHOT_INACTIVE_EXPRESSION_MAX_DEPTH || budget.remainingSteps < 0)
    return null;
  const node = stripParenExpression(expression);
  if (
    isNodeOfType(node, "Literal") &&
    (node.value === null ||
      typeof node.value === "string" ||
      typeof node.value === "number" ||
      typeof node.value === "boolean")
  )
    return { value: node.value };
  if (isNodeOfType(node, "UnaryExpression") && node.operator === "!") {
    const truthiness = readSnapshotTruthiness(node.argument, depth + 1, budget);
    return truthiness === null ? null : { value: !truthiness };
  }
  if (
    isNodeOfType(node, "LogicalExpression") &&
    (node.operator === "&&" || node.operator === "||")
  ) {
    const left = readSnapshotPrimitive(node.left, depth + 1, budget);
    if (!left) return null;
    if ((node.operator === "&&" && !left.value) || (node.operator === "||" && left.value))
      return left;
    return readSnapshotPrimitive(node.right, depth + 1, budget);
  }
  if (
    isNodeOfType(node, "BinaryExpression") &&
    ["===", "!==", "==", "!="].includes(node.operator)
  ) {
    const left = readSnapshotPrimitive(node.left, depth + 1, budget);
    const right = readSnapshotPrimitive(node.right, depth + 1, budget);
    if (
      !left ||
      !right ||
      ((node.operator === "==" || node.operator === "!=") &&
        typeof left.value !== typeof right.value)
    )
      return null;
    const isEqual = left.value === right.value;
    return { value: node.operator === "!==" || node.operator === "!=" ? !isEqual : isEqual };
  }
  return null;
};

const readSnapshotTruthiness = (
  expression: EsTreeNode,
  depth: number,
  budget: SnapshotBranchBudget,
): boolean | null => {
  budget.remainingSteps -= 1;
  if (depth > CLOSED_JSON_SNAPSHOT_INACTIVE_EXPRESSION_MAX_DEPTH || budget.remainingSteps < 0)
    return null;
  const primitive = readSnapshotPrimitive(expression, depth + 1, budget);
  if (primitive) return Boolean(primitive.value);
  const node = stripParenExpression(expression);
  if (
    isNodeOfType(node, "LogicalExpression") &&
    (node.operator === "&&" || node.operator === "||")
  ) {
    const left = readSnapshotTruthiness(node.left, depth + 1, budget);
    const right = readSnapshotTruthiness(node.right, depth + 1, budget);
    if (node.operator === "&&")
      return left === false || right === false
        ? false
        : left === true && right === true
          ? true
          : null;
    return left === true || right === true
      ? true
      : left === false && right === false
        ? false
        : null;
  }
  return null;
};

export const isClosedJsonSnapshotInactiveBranch = (node: EsTreeNode): boolean => {
  const budget: SnapshotBranchBudget = {
    remainingSteps: CLOSED_JSON_SNAPSHOT_INACTIVE_EXPRESSION_MAX_STEPS,
  };
  let child = node;
  let ancestor = node.parent;
  let depth = 0;
  while (ancestor && depth < CLOSED_JSON_SNAPSHOT_INACTIVE_BRANCH_MAX_DEPTH) {
    depth += 1;
    if (isNodeOfType(ancestor, "IfStatement") || isNodeOfType(ancestor, "ConditionalExpression")) {
      const truthiness = readSnapshotTruthiness(ancestor.test, 0, budget);
      if (budget.remainingSteps < 0) return false;
      if (
        (truthiness === false && ancestor.consequent === child) ||
        (truthiness === true && ancestor.alternate === child)
      )
        return true;
    }
    if (isNodeOfType(ancestor, "LogicalExpression") && ancestor.right === child) {
      const truthiness = readSnapshotTruthiness(ancestor.left, 0, budget);
      if (budget.remainingSteps < 0) return false;
      if (
        (ancestor.operator === "&&" && truthiness === false) ||
        (ancestor.operator === "||" && truthiness === true)
      )
        return true;
    }
    child = ancestor;
    ancestor = ancestor.parent;
  }
  return false;
};
