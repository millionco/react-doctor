import ts from "typescript";
import { getResolvedSymbol } from "./get-resolved-symbol.js";
import { isAssignmentOperator } from "./is-assignment-operator.js";

export const collectPropertySymbolWrites = (
  symbol: ts.Symbol,
  sourceFile: ts.SourceFile,
  typeChecker: ts.TypeChecker,
): ReadonlyArray<ts.Node> => {
  const isPropertyTarget = (node: ts.Node): boolean => {
    if (ts.isPropertyAccessExpression(node)) {
      return getResolvedSymbol(node.name, typeChecker) === symbol;
    }
    if (ts.isElementAccessExpression(node)) {
      return getResolvedSymbol(node, typeChecker) === symbol;
    }
    if (
      ts.isParenthesizedExpression(node) ||
      ts.isAsExpression(node) ||
      ts.isTypeAssertionExpression(node) ||
      ts.isNonNullExpression(node) ||
      ts.isSatisfiesExpression(node)
    ) {
      return isPropertyTarget(node.expression);
    }
    return false;
  };
  const writes: ts.Node[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isBinaryExpression(node) &&
      isAssignmentOperator(node.operatorToken.kind) &&
      isPropertyTarget(node.left)
    ) {
      writes.push(node);
    }
    if (
      (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) &&
      (node.operator === ts.SyntaxKind.PlusPlusToken ||
        node.operator === ts.SyntaxKind.MinusMinusToken) &&
      isPropertyTarget(node.operand)
    ) {
      writes.push(node);
    }
    if (ts.isDeleteExpression(node) && isPropertyTarget(node.expression)) {
      writes.push(node);
    }
    if (
      (ts.isForInStatement(node) || ts.isForOfStatement(node)) &&
      !ts.isVariableDeclarationList(node.initializer) &&
      isPropertyTarget(node.initializer)
    ) {
      writes.push(node);
    }
    node.forEachChild(visit);
  };
  sourceFile.forEachChild(visit);
  return writes;
};
