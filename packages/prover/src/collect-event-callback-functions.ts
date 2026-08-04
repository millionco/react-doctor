import ts from "typescript";
import { collectReachableFunctions } from "./collect-reachable-functions.js";
import { REACT_EVENT_PROP_PATTERN } from "./constants.js";
import { isFunctionBoundary } from "./is-function-boundary.js";
import { resolveFunction } from "./resolve-function.js";

export const collectEventCallbackFunctions = (
  functionNode: ts.FunctionLikeDeclaration,
  typeChecker: ts.TypeChecker,
): ReadonlyArray<ts.FunctionLikeDeclaration> => {
  const callbacks = new Set<ts.FunctionLikeDeclaration>();
  for (const reachableFunction of collectReachableFunctions(functionNode, typeChecker)) {
    const visit = (node: ts.Node): void => {
      if (node !== reachableFunction.functionNode && isFunctionBoundary(node)) return;
      if (
        ts.isJsxAttribute(node) &&
        REACT_EVENT_PROP_PATTERN.test(node.name.getText()) &&
        node.initializer &&
        ts.isJsxExpression(node.initializer) &&
        node.initializer.expression
      ) {
        const callback = resolveFunction(node.initializer.expression, typeChecker);
        if (callback) callbacks.add(callback);
      }
      node.forEachChild(visit);
    };
    reachableFunction.functionNode.forEachChild(visit);
  }
  return [...callbacks];
};
