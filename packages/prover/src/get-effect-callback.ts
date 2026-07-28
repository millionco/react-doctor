import ts from "typescript";

export const getEffectCallback = (
  callExpression: ts.CallExpression,
  typeChecker: ts.TypeChecker,
): ts.FunctionLikeDeclaration | null => {
  const callbackExpression = callExpression.arguments[0];
  if (!callbackExpression) return null;
  if (ts.isFunctionExpression(callbackExpression) || ts.isArrowFunction(callbackExpression)) {
    return callbackExpression;
  }
  const callbackSymbol = typeChecker.getSymbolAtLocation(callbackExpression);
  const resolvedSymbol =
    callbackSymbol && (callbackSymbol.flags & ts.SymbolFlags.Alias) !== 0
      ? typeChecker.getAliasedSymbol(callbackSymbol)
      : callbackSymbol;
  for (const declaration of resolvedSymbol?.declarations ?? []) {
    if (
      ts.isFunctionDeclaration(declaration) ||
      ts.isFunctionExpression(declaration) ||
      ts.isArrowFunction(declaration)
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
  }
  return null;
};
