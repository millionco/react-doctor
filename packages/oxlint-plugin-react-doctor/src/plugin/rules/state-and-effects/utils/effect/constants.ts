import * as eslintVisitorKeys from "eslint-visitor-keys";

const TYPESCRIPT_VISITOR_KEYS: Readonly<Record<string, ReadonlyArray<string>>> = {
  TSAsExpression: ["expression", "typeAnnotation"],
  TSNonNullExpression: ["expression"],
  TSSatisfiesExpression: ["expression", "typeAnnotation"],
  TSTypeAssertion: ["typeAnnotation", "expression"],
  TSInstantiationExpression: ["expression", "typeArguments"],
};

export const VISITOR_KEYS: Readonly<Record<string, ReadonlyArray<string>>> = {
  ...eslintVisitorKeys.KEYS,
  ...TYPESCRIPT_VISITOR_KEYS,
};
