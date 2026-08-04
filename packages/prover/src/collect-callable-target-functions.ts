import ts from "typescript";
import type { ResolvedCallableValueDescriptor } from "./resolve-callable-expression.js";

export const collectCallableTargetFunctions = (
  bindings: ReadonlyMap<ts.Symbol, ResolvedCallableValueDescriptor>,
): ReadonlySet<ts.FunctionLikeDeclaration> => {
  const functionNodes = new Set<ts.FunctionLikeDeclaration>();
  const visitedValues = new Set<ResolvedCallableValueDescriptor>();
  const visitValue = (value: ResolvedCallableValueDescriptor): void => {
    if (visitedValues.has(value)) return;
    visitedValues.add(value);
    for (const target of value.targets) {
      functionNodes.add(target.functionNode);
      for (const capturedValue of target.bindings.values()) visitValue(capturedValue);
    }
    for (const propertyValue of value.properties.values()) visitValue(propertyValue);
  };
  for (const value of bindings.values()) visitValue(value);
  return functionNodes;
};
