import ts from "typescript";
import { collectReachableFunctions } from "../collect-reachable-functions.js";
import { isFunctionBoundary } from "../is-function-boundary.js";

export const collectReachableCallExpressions = (
  functionNode: ts.FunctionLikeDeclaration,
  typeChecker: ts.TypeChecker,
): ReadonlyArray<ts.CallExpression> => {
  const calls: ts.CallExpression[] = [];
  for (const reachableFunction of collectReachableFunctions(functionNode, typeChecker)) {
    const visit = (node: ts.Node): void => {
      if (node !== reachableFunction.functionNode && isFunctionBoundary(node)) return;
      if (ts.isCallExpression(node)) calls.push(node);
      node.forEachChild(visit);
    };
    reachableFunction.functionNode.forEachChild(visit);
  }
  return calls;
};
