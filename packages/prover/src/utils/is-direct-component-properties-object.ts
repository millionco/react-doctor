import ts from "typescript";

export const isDirectComponentPropertiesObject = (
  expression: ts.Expression,
  functionNode: ts.FunctionLikeDeclaration,
  typeChecker: ts.TypeChecker,
): boolean => {
  if (!ts.isIdentifier(expression)) return false;
  const expressionSymbol = typeChecker.getSymbolAtLocation(expression);
  if (!expressionSymbol) return false;
  return functionNode.parameters.some((parameter) => {
    if (
      ts.isIdentifier(parameter.name) &&
      typeChecker.getSymbolAtLocation(parameter.name) === expressionSymbol
    ) {
      return true;
    }
    return (
      ts.isObjectBindingPattern(parameter.name) &&
      parameter.name.elements.some(
        (element) =>
          Boolean(element.dotDotDotToken) &&
          ts.isIdentifier(element.name) &&
          typeChecker.getSymbolAtLocation(element.name) === expressionSymbol,
      )
    );
  });
};
