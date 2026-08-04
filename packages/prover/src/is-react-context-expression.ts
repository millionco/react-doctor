import ts from "typescript";

const isReactContextType = (valueType: ts.Type): boolean => {
  if (valueType.isUnionOrIntersection()) {
    return valueType.types.every(isReactContextType);
  }
  const symbol = valueType.aliasSymbol ?? valueType.getSymbol();
  return symbol?.name === "Context";
};

export const isReactContextExpression = (
  expression: ts.Expression,
  typeChecker: ts.TypeChecker,
): boolean => isReactContextType(typeChecker.getTypeAtLocation(expression));
