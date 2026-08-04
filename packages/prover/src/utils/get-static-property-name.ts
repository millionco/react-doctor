import ts from "typescript";

export const getStaticPropertyName = (propertyName: ts.PropertyName): string | null => {
  if (
    ts.isIdentifier(propertyName) ||
    ts.isPrivateIdentifier(propertyName) ||
    ts.isStringLiteralLike(propertyName) ||
    ts.isNumericLiteral(propertyName) ||
    ts.isBigIntLiteral(propertyName)
  ) {
    return propertyName.text;
  }
  return ts.isStringLiteralLike(propertyName.expression) ? propertyName.expression.text : null;
};
