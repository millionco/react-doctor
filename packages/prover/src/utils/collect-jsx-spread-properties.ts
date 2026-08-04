import ts from "typescript";
import { doesTypeContainCallable } from "../resolve-callable-expression.js";

export interface JsxSpreadPropertiesDescriptor {
  callablePropertyNames: ReadonlyArray<string>;
  hasUnknownProperties: boolean;
  propertyNames: ReadonlyArray<string>;
}

export const collectJsxSpreadProperties = (
  expression: ts.Expression,
  typeChecker: ts.TypeChecker,
): JsxSpreadPropertiesDescriptor => {
  const callablePropertyNames = new Set<string>();
  const propertyNames = new Set<string>();
  const visitedTypes = new Set<ts.Type>();
  let hasUnknownProperties = false;

  const visitType = (type: ts.Type): void => {
    if (visitedTypes.has(type)) return;
    visitedTypes.add(type);
    if (type.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown | ts.TypeFlags.TypeParameter)) {
      hasUnknownProperties = true;
    }
    if (type.getStringIndexType() || type.getNumberIndexType()) {
      hasUnknownProperties = true;
    }
    if (type.isUnionOrIntersection()) {
      for (const memberType of type.types) visitType(memberType);
      return;
    }
    for (const propertySymbol of type.getProperties()) {
      const propertyName = propertySymbol.getName();
      propertyNames.add(propertyName);
      const propertyType = typeChecker.getTypeOfSymbolAtLocation(propertySymbol, expression);
      if (doesTypeContainCallable(propertyType, typeChecker)) {
        callablePropertyNames.add(propertyName);
      }
    }
  };

  visitType(typeChecker.getTypeAtLocation(expression));
  return {
    callablePropertyNames: [...callablePropertyNames].sort(),
    hasUnknownProperties,
    propertyNames: [...propertyNames].sort(),
  };
};
