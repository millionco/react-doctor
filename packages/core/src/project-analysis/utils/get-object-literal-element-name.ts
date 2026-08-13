import ts from "typescript";

export const getObjectLiteralElementName = (
  property: ts.ObjectLiteralElementLike,
): string | undefined => {
  if (!ts.isPropertyAssignment(property) && !ts.isShorthandPropertyAssignment(property)) {
    return undefined;
  }
  return ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)
    ? property.name.text
    : undefined;
};
