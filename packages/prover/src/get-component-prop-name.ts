import ts from "typescript";

const getDestructuredPropName = (
  identifier: ts.Identifier,
  functionNode: ts.FunctionLikeDeclaration,
  typeChecker: ts.TypeChecker,
): string | null => {
  const identifierSymbol = typeChecker.getSymbolAtLocation(identifier);
  if (!identifierSymbol) return null;
  for (const parameter of functionNode.parameters) {
    if (!ts.isObjectBindingPattern(parameter.name)) continue;
    for (const bindingElement of parameter.name.elements) {
      if (
        !ts.isIdentifier(bindingElement.name) ||
        typeChecker.getSymbolAtLocation(bindingElement.name) !== identifierSymbol
      ) {
        continue;
      }
      const propertyName = bindingElement.propertyName;
      if (!propertyName) return bindingElement.name.text;
      if (ts.isIdentifier(propertyName) || ts.isStringLiteral(propertyName)) {
        return propertyName.text;
      }
      return null;
    }
  }
  return null;
};

const getObjectParameterPropName = (
  expression: ts.PropertyAccessExpression,
  functionNode: ts.FunctionLikeDeclaration,
  typeChecker: ts.TypeChecker,
): string | null => {
  if (!ts.isIdentifier(expression.expression)) return null;
  const expressionSymbol = typeChecker.getSymbolAtLocation(expression.expression);
  if (!expressionSymbol) return null;
  return functionNode.parameters.some(
    (parameter) =>
      ts.isIdentifier(parameter.name) &&
      typeChecker.getSymbolAtLocation(parameter.name) === expressionSymbol,
  )
    ? expression.name.text
    : null;
};

export const getComponentPropName = (
  expression: ts.Expression,
  functionNode: ts.FunctionLikeDeclaration,
  typeChecker: ts.TypeChecker,
): string | null => {
  if (ts.isIdentifier(expression)) {
    return getDestructuredPropName(expression, functionNode, typeChecker);
  }
  if (ts.isPropertyAccessExpression(expression)) {
    return getObjectParameterPropName(expression, functionNode, typeChecker);
  }
  return null;
};
