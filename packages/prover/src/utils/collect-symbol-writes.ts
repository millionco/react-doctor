import ts from "typescript";

export const collectSymbolWrites = (
  symbol: ts.Symbol,
  sourceFile: ts.SourceFile,
  typeChecker: ts.TypeChecker,
): ReadonlyArray<ts.Node> => {
  const writes: ts.Node[] = [];
  const isSymbolWriteTarget = (node: ts.Node): boolean => {
    if (ts.isIdentifier(node)) return typeChecker.getSymbolAtLocation(node) === symbol;
    if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
      return isSymbolWriteTarget(node.expression);
    }
    if (
      ts.isParenthesizedExpression(node) ||
      ts.isAsExpression(node) ||
      ts.isTypeAssertionExpression(node) ||
      ts.isNonNullExpression(node) ||
      ts.isSatisfiesExpression(node)
    ) {
      return isSymbolWriteTarget(node.expression);
    }
    if (ts.isArrayLiteralExpression(node)) {
      return node.elements.some((element) =>
        ts.isSpreadElement(element)
          ? isSymbolWriteTarget(element.expression)
          : isSymbolWriteTarget(element),
      );
    }
    if (ts.isObjectLiteralExpression(node)) {
      return node.properties.some((property) => {
        if (ts.isShorthandPropertyAssignment(property)) {
          return isSymbolWriteTarget(property.name);
        }
        if (ts.isPropertyAssignment(property)) {
          return isSymbolWriteTarget(property.initializer);
        }
        if (ts.isSpreadAssignment(property)) {
          return isSymbolWriteTarget(property.expression);
        }
        return false;
      });
    }
    return false;
  };
  const visit = (node: ts.Node): void => {
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
      node.operatorToken.kind <= ts.SyntaxKind.LastAssignment &&
      isSymbolWriteTarget(node.left)
    ) {
      writes.push(node);
    }
    if (
      (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) &&
      (node.operator === ts.SyntaxKind.PlusPlusToken ||
        node.operator === ts.SyntaxKind.MinusMinusToken) &&
      isSymbolWriteTarget(node.operand)
    ) {
      writes.push(node);
    }
    if (ts.isDeleteExpression(node) && isSymbolWriteTarget(node.expression)) {
      writes.push(node);
    }
    if (
      (ts.isForInStatement(node) || ts.isForOfStatement(node)) &&
      !ts.isVariableDeclarationList(node.initializer) &&
      isSymbolWriteTarget(node.initializer)
    ) {
      writes.push(node);
    }
    node.forEachChild(visit);
  };
  sourceFile.forEachChild(visit);
  return writes;
};
