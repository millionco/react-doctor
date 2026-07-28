import ts from "typescript";
import { getCanonicalHookName } from "../get-canonical-hook-name.js";
import { unwrapTypescriptExpression } from "../unwrap-typescript-expression.js";

export const isReactHookDependencyReference = (
  identifier: ts.Identifier,
  typeChecker: ts.TypeChecker,
): boolean => {
  let currentNode: ts.Node = identifier;
  while (
    currentNode.parent &&
    ts.isExpression(currentNode.parent) &&
    unwrapTypescriptExpression(currentNode.parent) === identifier
  ) {
    currentNode = currentNode.parent;
  }
  if (!currentNode.parent || !ts.isArrayLiteralExpression(currentNode.parent)) return false;
  const dependencyArray = currentNode.parent;
  const hookCall = dependencyArray.parent;
  if (!ts.isCallExpression(hookCall)) return false;
  return (
    hookCall.arguments.indexOf(dependencyArray) > 0 &&
    Boolean(getCanonicalHookName(hookCall, typeChecker))
  );
};
