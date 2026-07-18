import type { ScopeAnalysis, SymbolDescriptor } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isReactApiCall } from "./is-react-api-call.js";
import { stripParenExpression } from "./strip-paren-expression.js";
import { symbolHasReactUseEffectEventOrigin } from "./symbol-has-react-use-effect-event-origin.js";

export const getTransparentReactCallbackWrapperArgument = (
  initializer: EsTreeNode,
  resultSymbol: SymbolDescriptor | null,
  scopes: ScopeAnalysis,
): EsTreeNode | null => {
  const callExpression = stripParenExpression(initializer);
  if (!isNodeOfType(callExpression, "CallExpression")) return null;
  const callbackArgument = callExpression.arguments[0] as EsTreeNode | undefined;
  if (!callbackArgument) return null;
  if (resultSymbol && symbolHasReactUseEffectEventOrigin(resultSymbol, scopes)) {
    return callbackArgument;
  }
  return isReactApiCall(callExpression, "useCallback", scopes, {
    allowGlobalReactNamespace: true,
    allowUnboundBareCalls: true,
  })
    ? callbackArgument
    : null;
};
