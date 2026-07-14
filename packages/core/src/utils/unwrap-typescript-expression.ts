import ts from "typescript";

export const unwrapTypescriptExpression = (expression: ts.Expression): ts.Expression => {
  let currentExpression = expression;
  while (
    ts.isParenthesizedExpression(currentExpression) ||
    ts.isAsExpression(currentExpression) ||
    ts.isSatisfiesExpression(currentExpression) ||
    ts.isNonNullExpression(currentExpression) ||
    ts.isTypeAssertionExpression(currentExpression)
  ) {
    currentExpression = currentExpression.expression;
  }
  return currentExpression;
};
