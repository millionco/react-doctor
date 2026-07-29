import ts from "typescript";

export const resolveAliasedSymbol = (symbol: ts.Symbol, typeChecker: ts.TypeChecker): ts.Symbol =>
  symbol.flags & ts.SymbolFlags.Alias ? typeChecker.getAliasedSymbol(symbol) : symbol;
