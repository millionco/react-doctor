import type ts from "typescript";
import { resolveAliasedSymbol } from "./resolve-aliased-symbol.js";

export const getExpressionSymbol = (
  expression: ts.Expression | ts.JsxTagNameExpression,
  typeChecker: ts.TypeChecker,
): ts.Symbol | null => {
  const symbol = typeChecker.getSymbolAtLocation(expression);
  return symbol ? resolveAliasedSymbol(symbol, typeChecker) : null;
};
