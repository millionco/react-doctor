import ts from "typescript";

export const getRootIdentifier = (expression: ts.Expression): ts.Identifier | null => {
  if (ts.isIdentifier(expression)) return expression;
  if (ts.isPropertyAccessExpression(expression) || ts.isElementAccessExpression(expression)) {
    return getRootIdentifier(expression.expression);
  }
  return null;
};
