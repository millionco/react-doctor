import ts from "typescript";
import { getCanonicalHookName } from "./get-canonical-hook-name.js";
import { isFunctionBoundary } from "./is-function-boundary.js";
import { isReactHookName } from "./is-react-hook-name.js";

export const collectDirectHookCalls = (
  owner: ts.Node,
  typeChecker: ts.TypeChecker,
): ReadonlyArray<ts.CallExpression> => {
  const hookCalls: ts.CallExpression[] = [];
  const visit = (node: ts.Node): void => {
    if (node !== owner && isFunctionBoundary(node)) {
      return;
    }
    if (ts.isCallExpression(node)) {
      const callName = getCanonicalHookName(node, typeChecker);
      if (callName && isReactHookName(callName)) hookCalls.push(node);
    }
    node.forEachChild(visit);
  };
  owner.forEachChild(visit);
  return hookCalls;
};
