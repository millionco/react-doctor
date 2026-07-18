import type { ScopeAnalysis } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { resolveConstIdentifierAlias } from "../../../utils/resolve-const-identifier-alias.js";
import { resolveExactLocalFunction } from "../../../utils/resolve-exact-local-function.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import { isR3fReactApiCall } from "./is-r3f-react-api-call.js";

export const resolveLocalReactCallback = (
  expression: EsTreeNode,
  scopes: ScopeAnalysis,
): EsTreeNode | null => {
  const localFunction = resolveExactLocalFunction(expression, scopes);
  if (localFunction) return localFunction;
  const unwrappedExpression = stripParenExpression(expression);
  const callbackSymbol = isNodeOfType(unwrappedExpression, "Identifier")
    ? resolveConstIdentifierAlias(unwrappedExpression, scopes)
    : null;
  const callbackInitializer = callbackSymbol?.kind === "const" ? callbackSymbol.initializer : null;
  const wrapperCall = stripParenExpression(callbackInitializer ?? unwrappedExpression);
  if (!isNodeOfType(wrapperCall, "CallExpression")) return null;
  if (!isR3fReactApiCall(wrapperCall, "useCallback", scopes)) return null;
  const wrappedCallback = wrapperCall.arguments[0];
  if (!wrappedCallback || isNodeOfType(wrappedCallback, "SpreadElement")) return null;
  return resolveExactLocalFunction(wrappedCallback, scopes);
};
