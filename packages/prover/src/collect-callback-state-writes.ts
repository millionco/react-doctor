import ts from "typescript";
import { collectHookBindings } from "./collect-hook-bindings.js";
import { collectReachableFunctions } from "./collect-reachable-functions.js";
import { getCallName } from "./get-call-name.js";
import { isFunctionBoundary } from "./is-function-boundary.js";

export const collectCallbackStateWrites = (
  callbackFunction: ts.FunctionLikeDeclaration,
  ownerFunction: ts.FunctionLikeDeclaration,
  typeChecker: ts.TypeChecker,
): ReadonlyArray<string> => {
  const stateSetters = collectHookBindings(ownerFunction, typeChecker).stateSetters;
  const stateWriteNames = new Set<string>();
  for (const reachableFunction of collectReachableFunctions(callbackFunction, typeChecker)) {
    const visit = (node: ts.Node): void => {
      if (node !== reachableFunction.functionNode && isFunctionBoundary(node)) return;
      if (ts.isCallExpression(node)) {
        const callSymbol = typeChecker.getSymbolAtLocation(node.expression);
        if (callSymbol && stateSetters.has(callSymbol)) {
          stateWriteNames.add(getCallName(node) ?? "state setter");
        }
      }
      node.forEachChild(visit);
    };
    reachableFunction.functionNode.forEachChild(visit);
  }
  return [...stateWriteNames];
};
