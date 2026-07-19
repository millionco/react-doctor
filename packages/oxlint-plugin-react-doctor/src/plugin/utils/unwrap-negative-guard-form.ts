import type { EsTreeNode } from "./es-tree-node.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { stripParenExpression } from "./strip-paren-expression.js";

// `!guard`, `guard === null/undefined`, `guard == null`, and
// `guard.indexOf(x) === -1` all assert the guard FAILED — so the branch
// where the test is false (a ternary/if alternate, or the code after an
// early exit) is dominated by the guard succeeding. Returns the positive
// guard expression, or null when the test is not a recognized negative form.
export const unwrapNegativeGuardForm = (test: EsTreeNode): EsTreeNode | null => {
  const expression = stripParenExpression(test);
  if (isNodeOfType(expression, "LogicalExpression") && expression.operator === "||") {
    return (
      unwrapNegativeGuardForm(expression.left as EsTreeNode) ??
      unwrapNegativeGuardForm(expression.right as EsTreeNode)
    );
  }
  if (isNodeOfType(expression, "UnaryExpression") && expression.operator === "!") {
    return stripParenExpression(expression.argument);
  }
  if (
    isNodeOfType(expression, "BinaryExpression") &&
    (expression.operator === "===" || expression.operator === "==")
  ) {
    const isAbsenceLiteral = (side: EsTreeNode): boolean =>
      (isNodeOfType(side, "Literal") && side.value === null) ||
      (isNodeOfType(side, "Identifier") && side.name === "undefined") ||
      (isNodeOfType(side, "UnaryExpression") &&
        side.operator === "-" &&
        isNodeOfType(side.argument, "Literal") &&
        side.argument.value === 1);
    const left = stripParenExpression(expression.left);
    const right = stripParenExpression(expression.right);
    if (isAbsenceLiteral(right)) return left;
    if (isAbsenceLiteral(left)) return right;
  }
  if (
    isNodeOfType(expression, "BinaryExpression") &&
    (expression.operator === "!==" || expression.operator === "!=")
  ) {
    const operandPairs: Array<[EsTreeNode, EsTreeNode]> = [
      [expression.left as EsTreeNode, expression.right as EsTreeNode],
      [expression.right as EsTreeNode, expression.left as EsTreeNode],
    ];
    for (const [candidateTypeof, candidateType] of operandPairs) {
      const typeofExpression = stripParenExpression(candidateTypeof);
      const typeExpression = stripParenExpression(candidateType);
      if (
        isNodeOfType(typeofExpression, "UnaryExpression") &&
        typeofExpression.operator === "typeof" &&
        isNodeOfType(typeExpression, "Literal") &&
        typeof typeExpression.value === "string" &&
        typeExpression.value !== "undefined"
      ) {
        return stripParenExpression(typeofExpression.argument);
      }
    }
  }
  if (
    isNodeOfType(expression, "BinaryExpression") &&
    (expression.operator === "===" || expression.operator === "==" || expression.operator === "<=")
  ) {
    const operandPairs: Array<[EsTreeNode, EsTreeNode]> = [
      [expression.left as EsTreeNode, expression.right as EsTreeNode],
      [expression.right as EsTreeNode, expression.left as EsTreeNode],
    ];
    for (const [candidateLength, candidateZero] of operandPairs) {
      const lengthExpression = stripParenExpression(candidateLength);
      const zeroExpression = stripParenExpression(candidateZero);
      if (
        isNodeOfType(lengthExpression, "MemberExpression") &&
        !lengthExpression.computed &&
        isNodeOfType(lengthExpression.property, "Identifier") &&
        lengthExpression.property.name === "length" &&
        isNodeOfType(zeroExpression, "Literal") &&
        zeroExpression.value === 0
      ) {
        return stripParenExpression(lengthExpression.object as EsTreeNode);
      }
    }
  }
  return null;
};
