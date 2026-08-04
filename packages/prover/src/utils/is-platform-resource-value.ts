import ts from "typescript";
import { unwrapTypescriptExpression } from "../unwrap-typescript-expression.js";
import { collectSymbolWrites } from "./collect-symbol-writes.js";
import { getResolvedSymbol } from "./get-resolved-symbol.js";
import { isPlatformDeclarationSymbol } from "./is-platform-declaration-symbol.js";

export const isPlatformResourceValue = (
  expression: ts.Expression,
  typeChecker: ts.TypeChecker,
  visitedSymbols: ReadonlySet<ts.Symbol> = new Set(),
): boolean => {
  const unwrappedExpression = unwrapTypescriptExpression(expression);
  if (ts.isIdentifier(unwrappedExpression)) {
    const symbol = getResolvedSymbol(unwrappedExpression, typeChecker);
    if (isPlatformDeclarationSymbol(symbol)) return true;
    if (!symbol || visitedSymbols.has(symbol)) return false;
    for (const declaration of symbol.declarations ?? []) {
      if (
        ts.isVariableDeclaration(declaration) &&
        ts.isVariableDeclarationList(declaration.parent) &&
        Boolean(declaration.parent.flags & ts.NodeFlags.Const) &&
        declaration.initializer &&
        collectSymbolWrites(symbol, declaration.getSourceFile(), typeChecker).length === 0
      ) {
        return isPlatformResourceValue(
          declaration.initializer,
          typeChecker,
          new Set([...visitedSymbols, symbol]),
        );
      }
    }
    return false;
  }
  if (ts.isPropertyAccessExpression(unwrappedExpression)) {
    return (
      isPlatformDeclarationSymbol(getResolvedSymbol(unwrappedExpression.name, typeChecker)) &&
      isPlatformResourceValue(unwrappedExpression.expression, typeChecker, visitedSymbols)
    );
  }
  if (ts.isCallExpression(unwrappedExpression)) {
    const callTarget = unwrappedExpression.expression;
    if (ts.isPropertyAccessExpression(callTarget)) {
      return (
        isPlatformDeclarationSymbol(getResolvedSymbol(callTarget.name, typeChecker)) &&
        isPlatformResourceValue(callTarget.expression, typeChecker, visitedSymbols)
      );
    }
    return isPlatformDeclarationSymbol(getResolvedSymbol(callTarget, typeChecker));
  }
  return (
    ts.isNewExpression(unwrappedExpression) &&
    isPlatformDeclarationSymbol(getResolvedSymbol(unwrappedExpression.expression, typeChecker))
  );
};
