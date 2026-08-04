import ts from "typescript";
import { unwrapTypescriptExpression } from "../unwrap-typescript-expression.js";
import { collectSymbolWrites } from "./collect-symbol-writes.js";
import { getResolvedSymbol } from "./get-resolved-symbol.js";
import { collectPropertySymbolWrites } from "./collect-property-symbol-writes.js";
import { isPlatformDeclarationSymbol } from "./is-platform-declaration-symbol.js";

const getImmutableInitializer = (
  symbol: ts.Symbol,
  typeChecker: ts.TypeChecker,
): ts.Expression | null => {
  for (const declaration of symbol.declarations ?? []) {
    if (
      ts.isVariableDeclaration(declaration) &&
      ts.isVariableDeclarationList(declaration.parent) &&
      Boolean(declaration.parent.flags & ts.NodeFlags.Const) &&
      declaration.initializer &&
      collectSymbolWrites(symbol, declaration.getSourceFile(), typeChecker).length === 0
    ) {
      return declaration.initializer;
    }
  }
  return null;
};

const areLiteralExpressionsEqual = (
  leftExpression: ts.Expression,
  rightExpression: ts.Expression,
): boolean => {
  if (
    (ts.isStringLiteralLike(leftExpression) && ts.isStringLiteralLike(rightExpression)) ||
    (ts.isNumericLiteral(leftExpression) && ts.isNumericLiteral(rightExpression))
  ) {
    return leftExpression.text === rightExpression.text;
  }
  return (
    (leftExpression.kind === ts.SyntaxKind.TrueKeyword ||
      leftExpression.kind === ts.SyntaxKind.FalseKeyword ||
      leftExpression.kind === ts.SyntaxKind.NullKeyword) &&
    leftExpression.kind === rightExpression.kind
  );
};

export const areImmutableExpressionsIdentical = (
  leftExpression: ts.Expression,
  rightExpression: ts.Expression,
  typeChecker: ts.TypeChecker,
  visitedSymbols: ReadonlySet<ts.Symbol> = new Set(),
): boolean => {
  const unwrappedLeft = unwrapTypescriptExpression(leftExpression);
  const unwrappedRight = unwrapTypescriptExpression(rightExpression);
  if (unwrappedLeft === unwrappedRight) return true;
  if (areLiteralExpressionsEqual(unwrappedLeft, unwrappedRight)) return true;
  if (
    unwrappedLeft.kind === ts.SyntaxKind.ThisKeyword &&
    unwrappedRight.kind === ts.SyntaxKind.ThisKeyword
  ) {
    return true;
  }
  if (
    ts.isPropertyAccessExpression(unwrappedLeft) &&
    ts.isPropertyAccessExpression(unwrappedRight)
  ) {
    const leftPropertySymbol = getResolvedSymbol(unwrappedLeft.name, typeChecker);
    const rightPropertySymbol = getResolvedSymbol(unwrappedRight.name, typeChecker);
    const isStableProperty = Boolean(
      leftPropertySymbol &&
      leftPropertySymbol === rightPropertySymbol &&
      (isPlatformDeclarationSymbol(leftPropertySymbol) ||
        (leftPropertySymbol.declarations?.every(ts.isMethodDeclaration) &&
          collectPropertySymbolWrites(
            leftPropertySymbol,
            unwrappedLeft.getSourceFile(),
            typeChecker,
          ).length === 0)),
    );
    return (
      isStableProperty &&
      areImmutableExpressionsIdentical(
        unwrappedLeft.expression,
        unwrappedRight.expression,
        typeChecker,
        visitedSymbols,
      )
    );
  }
  if (!ts.isIdentifier(unwrappedLeft) || !ts.isIdentifier(unwrappedRight)) return false;
  const leftSymbol = getResolvedSymbol(unwrappedLeft, typeChecker);
  const rightSymbol = getResolvedSymbol(unwrappedRight, typeChecker);
  if (!leftSymbol || !rightSymbol) return false;
  if (leftSymbol === rightSymbol) {
    return (
      isPlatformDeclarationSymbol(leftSymbol) ||
      Boolean(getImmutableInitializer(leftSymbol, typeChecker)) ||
      Boolean(
        leftSymbol.declarations?.every(
          (declaration) =>
            ts.isFunctionDeclaration(declaration) ||
            ts.isMethodDeclaration(declaration) ||
            ts.isParameter(declaration),
        ),
      )
    );
  }
  if (visitedSymbols.has(leftSymbol) || visitedSymbols.has(rightSymbol)) return false;
  const leftInitializer = getImmutableInitializer(leftSymbol, typeChecker);
  const rightInitializer = getImmutableInitializer(rightSymbol, typeChecker);
  const nextVisitedSymbols = new Set([...visitedSymbols, leftSymbol, rightSymbol]);
  if (leftInitializer) {
    return areImmutableExpressionsIdentical(
      leftInitializer,
      rightInitializer ?? unwrappedRight,
      typeChecker,
      nextVisitedSymbols,
    );
  }
  return Boolean(
    rightInitializer &&
    areImmutableExpressionsIdentical(
      unwrappedLeft,
      rightInitializer,
      typeChecker,
      nextVisitedSymbols,
    ),
  );
};
