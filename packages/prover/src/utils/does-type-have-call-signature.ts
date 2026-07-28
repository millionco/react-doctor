import ts from "typescript";

export const doesTypeHaveCallSignature = (type: ts.Type): boolean =>
  type.getCallSignatures().length > 0 ||
  (type.isUnionOrIntersection() && type.types.some(doesTypeHaveCallSignature));
