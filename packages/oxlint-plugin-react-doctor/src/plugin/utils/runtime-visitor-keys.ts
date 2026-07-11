import { KEYS } from "eslint-visitor-keys";

export const RUNTIME_VISITOR_KEYS: Readonly<Record<string, ReadonlyArray<string> | undefined>> = {
  ...KEYS,
  ArrayPattern: ["decorators", ...KEYS.ArrayPattern],
  AssignmentPattern: ["decorators", ...KEYS.AssignmentPattern],
  ClassDeclaration: ["decorators", ...KEYS.ClassDeclaration],
  ClassExpression: ["decorators", ...KEYS.ClassExpression],
  Identifier: ["decorators", ...KEYS.Identifier],
  MethodDefinition: ["decorators", ...KEYS.MethodDefinition],
  ObjectPattern: ["decorators", ...KEYS.ObjectPattern],
  PropertyDefinition: ["decorators", ...KEYS.PropertyDefinition],
  RestElement: ["decorators", ...KEYS.RestElement],
};
