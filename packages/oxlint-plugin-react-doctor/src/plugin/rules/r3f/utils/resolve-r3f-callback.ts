import type { ScopeAnalysis } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { isReactApiCall } from "../../../utils/is-react-api-call.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { resolveConstIdentifierAlias } from "../../../utils/resolve-const-identifier-alias.js";
import { resolveExactLocalFunction } from "../../../utils/resolve-exact-local-function.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import { isR3fApiCall } from "./is-r3f-api-call.js";

export const resolveR3fCallback = (
  callExpression: EsTreeNode,
  hookName: string,
  scopes: ScopeAnalysis,
): EsTreeNode | null => {
  if (!isR3fApiCall(callExpression, hookName, scopes)) return null;
  if (!isNodeOfType(callExpression, "CallExpression")) return null;
  const callback = callExpression.arguments[0];
  if (!callback || isNodeOfType(callback, "SpreadElement")) return null;
  const localFunction = resolveExactLocalFunction(callback, scopes);
  if (localFunction) return localFunction;
  const unwrappedCallback = stripParenExpression(callback);
  const callbackSymbol = isNodeOfType(unwrappedCallback, "Identifier")
    ? resolveConstIdentifierAlias(unwrappedCallback, scopes)
    : null;
  const callbackInitializer = callbackSymbol?.kind === "const" ? callbackSymbol.initializer : null;
  const wrapperCall = stripParenExpression(callbackInitializer ?? unwrappedCallback);
  if (!isReactApiCall(wrapperCall, "useCallback", scopes)) return null;
  if (!isNodeOfType(wrapperCall, "CallExpression")) return null;
  const wrappedCallback = wrapperCall.arguments[0];
  if (!wrappedCallback || isNodeOfType(wrappedCallback, "SpreadElement")) return null;
  return resolveExactLocalFunction(wrappedCallback, scopes);
};
