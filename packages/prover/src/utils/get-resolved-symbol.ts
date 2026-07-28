import ts from "typescript";

export const getResolvedSymbol = (node: ts.Node, typeChecker: ts.TypeChecker): ts.Symbol | null => {
  const symbol = typeChecker.getSymbolAtLocation(node);
  if (!symbol) return null;
  return symbol.flags & ts.SymbolFlags.Alias ? typeChecker.getAliasedSymbol(symbol) : symbol;
};
