import ts from "typescript";

export const getJsxComponentTargetFunction = (
  openingElement: ts.JsxOpeningLikeElement,
  unitFunctionsBySymbol: ReadonlyMap<ts.Symbol, ts.FunctionLikeDeclaration>,
  typeChecker: ts.TypeChecker,
): ts.FunctionLikeDeclaration | null => {
  const directSymbol = typeChecker.getSymbolAtLocation(openingElement.tagName);
  if (!directSymbol) return null;
  const targetSymbol =
    directSymbol.flags & ts.SymbolFlags.Alias
      ? typeChecker.getAliasedSymbol(directSymbol)
      : directSymbol;
  return unitFunctionsBySymbol.get(targetSymbol) ?? null;
};
