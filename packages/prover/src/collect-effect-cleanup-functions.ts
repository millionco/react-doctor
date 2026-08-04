import ts from "typescript";
import { resolveFunction } from "./resolve-function.js";
import { isFunctionBoundary } from "./is-function-boundary.js";

export const collectEffectCleanupFunctions = (
  effectCallback: ts.FunctionLikeDeclaration,
  typeChecker: ts.TypeChecker,
): ReadonlyArray<ts.FunctionLikeDeclaration> => {
  if (!effectCallback.body) return [];
  if (!ts.isBlock(effectCallback.body)) {
    const cleanupFunction = resolveFunction(effectCallback.body, typeChecker);
    return cleanupFunction ? [cleanupFunction] : [];
  }
  const cleanupFunctions: ts.FunctionLikeDeclaration[] = [];
  const cleanupFunctionSet = new Set<ts.FunctionLikeDeclaration>();
  const visit = (node: ts.Node): void => {
    if (node !== effectCallback.body && isFunctionBoundary(node)) {
      return;
    }
    if (ts.isReturnStatement(node) && node.expression) {
      const cleanupFunction = resolveFunction(node.expression, typeChecker);
      if (cleanupFunction && !cleanupFunctionSet.has(cleanupFunction)) {
        cleanupFunctionSet.add(cleanupFunction);
        cleanupFunctions.push(cleanupFunction);
      }
    }
    node.forEachChild(visit);
  };
  effectCallback.body.forEachChild(visit);
  return cleanupFunctions;
};
