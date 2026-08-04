import ts from "typescript";

export const getStaticAccessMemberName = (
  expression: ts.PropertyAccessExpression | ts.ElementAccessExpression,
): string | null => {
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text;
  const argument = expression.argumentExpression;
  return argument && (ts.isStringLiteralLike(argument) || ts.isNumericLiteral(argument))
    ? argument.text
    : null;
};
