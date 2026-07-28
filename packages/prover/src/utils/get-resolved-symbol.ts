import ts from "typescript";

export const getResolvedSymbol = (node: ts.Node, typeChecker: ts.TypeChecker): ts.Symbol | null => {
  const shorthandValueSymbol =
    ts.isIdentifier(node) && ts.isShorthandPropertyAssignment(node.parent)
      ? typeChecker.getShorthandAssignmentValueSymbol(node.parent)
      : undefined;
  const symbol = shorthandValueSymbol ?? typeChecker.getSymbolAtLocation(node);
  if (!symbol) return null;
  return symbol.flags & ts.SymbolFlags.Alias ? typeChecker.getAliasedSymbol(symbol) : symbol;
};
