import ts from "typescript";
import { getCallName } from "./get-call-name.js";

const resolveFunctionWithVisitedSymbols = (
  expression: ts.Expression,
  typeChecker: ts.TypeChecker,
  visitedSymbols: Set<ts.Symbol>,
): ts.FunctionLikeDeclaration | null => {
  if (ts.isFunctionExpression(expression) || ts.isArrowFunction(expression)) return expression;
  const directSymbol = typeChecker.getSymbolAtLocation(expression);
  const expressionSymbol =
    directSymbol && (directSymbol.flags & ts.SymbolFlags.Alias) !== 0
      ? typeChecker.getAliasedSymbol(directSymbol)
      : directSymbol;
  if (expressionSymbol && visitedSymbols.has(expressionSymbol)) return null;
  if (expressionSymbol) visitedSymbols.add(expressionSymbol);
  for (const declaration of expressionSymbol?.declarations ?? []) {
    if (
      (ts.isFunctionDeclaration(declaration) && Boolean(declaration.body)) ||
      ts.isFunctionExpression(declaration) ||
      ts.isArrowFunction(declaration) ||
      (ts.isMethodDeclaration(declaration) && Boolean(declaration.body))
    ) {
      return declaration;
    }
    if (
      ts.isVariableDeclaration(declaration) &&
      declaration.initializer &&
      (ts.isFunctionExpression(declaration.initializer) ||
        ts.isArrowFunction(declaration.initializer))
    ) {
      return declaration.initializer;
    }
    if (
      ts.isVariableDeclaration(declaration) &&
      declaration.initializer &&
      ts.isCallExpression(declaration.initializer) &&
      getCallName(declaration.initializer)?.split(".").at(-1) === "useCallback"
    ) {
      const callbackExpression = declaration.initializer.arguments[0];
      if (callbackExpression) {
        return resolveFunctionWithVisitedSymbols(callbackExpression, typeChecker, visitedSymbols);
      }
    }
  }
  return null;
};

export const resolveFunction = (
  expression: ts.Expression,
  typeChecker: ts.TypeChecker,
): ts.FunctionLikeDeclaration | null =>
  resolveFunctionWithVisitedSymbols(expression, typeChecker, new Set());
