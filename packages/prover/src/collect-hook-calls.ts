import ts from "typescript";
import { getCanonicalHookName } from "./get-canonical-hook-name.js";
import { isFunctionBoundary } from "./is-function-boundary.js";

export const collectHookCalls = (
  functionNode: ts.FunctionLikeDeclaration,
  hookNames: ReadonlySet<string>,
  typeChecker: ts.TypeChecker,
): ReadonlyArray<ts.CallExpression> => {
  const calls: ts.CallExpression[] = [];
  const visit = (node: ts.Node): void => {
    if (node !== functionNode && isFunctionBoundary(node)) return;
    if (ts.isCallExpression(node)) {
      const callName = getCanonicalHookName(node, typeChecker);
      if (callName && hookNames.has(callName)) calls.push(node);
    }
    node.forEachChild(visit);
  };
  functionNode.forEachChild(visit);
  return calls;
};
