import ts from "typescript";

const getExpressionName = (expression: ts.Expression): string | null => {
  if (ts.isIdentifier(expression)) return expression.text;
  if (ts.isPropertyAccessExpression(expression)) {
    const ownerName = getExpressionName(expression.expression);
    return ownerName ? `${ownerName}.${expression.name.text}` : expression.name.text;
  }
  if (
    ts.isElementAccessExpression(expression) &&
    expression.argumentExpression &&
    ts.isStringLiteral(expression.argumentExpression)
  ) {
    const ownerName = getExpressionName(expression.expression);
    return ownerName ? `${ownerName}.${expression.argumentExpression.text}` : null;
  }
  return null;
};

export const getCallName = (callExpression: ts.CallExpression): string | null =>
  getExpressionName(callExpression.expression);
