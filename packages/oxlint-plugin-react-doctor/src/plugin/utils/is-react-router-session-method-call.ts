import type { SymbolDescriptor } from "../semantic/scope-analysis.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isReactRouterSessionMethod } from "./is-react-router-session-method.js";
import type { RuleContext } from "./rule-context.js";

export const isReactRouterSessionMethodCall = (
  context: RuleContext,
  callExpression: EsTreeNodeOfType<"CallExpression">,
  sessionSymbol: SymbolDescriptor,
  expectedMethodName: string,
): boolean => {
  if (!isNodeOfType(callExpression.callee, "Identifier")) return false;
  const sessionArgument = callExpression.arguments?.[0];
  return (
    sessionArgument !== undefined &&
    context.scopes.symbolFor(sessionArgument) === sessionSymbol &&
    isReactRouterSessionMethod(
      context,
      context.scopes.symbolFor(callExpression.callee),
      expectedMethodName,
    )
  );
};
