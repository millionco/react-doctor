import ts from "typescript";
import { getCallName } from "./get-call-name.js";
import { getCanonicalReactApiName } from "./get-canonical-react-api-name.js";

const resolveCallableName = (
  expression: ts.Expression,
  typeChecker: ts.TypeChecker,
  visitedSymbols: Set<ts.Symbol>,
): string | null => {
  const directSymbol = typeChecker.getSymbolAtLocation(expression);
  const symbol =
    directSymbol && (directSymbol.flags & ts.SymbolFlags.Alias) !== 0
      ? typeChecker.getAliasedSymbol(directSymbol)
      : directSymbol;
  if (!symbol || visitedSymbols.has(symbol)) return null;
  visitedSymbols.add(symbol);
  if (symbol.name.startsWith("use")) return symbol.name;
  for (const declaration of symbol.declarations ?? []) {
    if (
      ts.isVariableDeclaration(declaration) &&
      declaration.initializer &&
      (ts.isIdentifier(declaration.initializer) ||
        ts.isPropertyAccessExpression(declaration.initializer) ||
        ts.isElementAccessExpression(declaration.initializer))
    ) {
      const initializerName = resolveCallableName(
        declaration.initializer,
        typeChecker,
        visitedSymbols,
      );
      if (initializerName) return initializerName;
    }
  }
  return symbol.name;
};

export const getCanonicalHookName = (
  callExpression: ts.CallExpression,
  typeChecker: ts.TypeChecker,
): string | null => {
  const syntaxName = getCallName(callExpression)?.split(".").at(-1) ?? null;
  const resolvedName =
    getCanonicalReactApiName(callExpression.expression, typeChecker) ??
    resolveCallableName(callExpression.expression, typeChecker, new Set());
  if (resolvedName?.startsWith("use")) return resolvedName;
  return syntaxName;
};
