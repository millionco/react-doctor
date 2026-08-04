import ts from "typescript";
import { getCanonicalHookName } from "./get-canonical-hook-name.js";
import { isFunctionBoundary } from "./is-function-boundary.js";
import { resolveFunction } from "./resolve-function.js";

export interface EffectEventBinding {
  callExpression: ts.CallExpression;
  callback: ts.FunctionLikeDeclaration | null;
  declaration: ts.VariableDeclaration;
  name: string;
  symbol: ts.Symbol;
}

export const collectEffectEventBindings = (
  functionNode: ts.FunctionLikeDeclaration,
  typeChecker: ts.TypeChecker,
): ReadonlyArray<EffectEventBinding> => {
  const bindings: EffectEventBinding[] = [];
  const visit = (node: ts.Node): void => {
    if (node !== functionNode && isFunctionBoundary(node)) return;
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      ts.isCallExpression(node.initializer) &&
      getCanonicalHookName(node.initializer, typeChecker) === "useEffectEvent"
    ) {
      const symbol = typeChecker.getSymbolAtLocation(node.name);
      const callbackExpression = node.initializer.arguments[0];
      if (symbol) {
        bindings.push({
          callExpression: node.initializer,
          callback: callbackExpression ? resolveFunction(callbackExpression, typeChecker) : null,
          declaration: node,
          name: node.name.text,
          symbol,
        });
      }
    }
    node.forEachChild(visit);
  };
  functionNode.forEachChild(visit);
  return bindings;
};
