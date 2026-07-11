import type { ScopeAnalysis, SymbolDescriptor } from "../semantic/scope-analysis.js";
import { isReactApiCall } from "./is-react-api-call.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { stripParenExpression } from "./strip-paren-expression.js";

// The ONE symbol-level answer to "is this binding the product of React's own
// `useEffectEvent`?" — the initializer is a `useEffectEvent(...)` /
// `React.useEffectEvent(...)` call whose callee does NOT resolve to a
// non-React polyfill (imported from another package or defined in this
// module). Every effect-event consumer (rules-of-hooks placement checks, the
// exhaustive-deps effect-event dep message) must go through this predicate so
// an origin-resolution fix lands everywhere at once.
export const symbolHasReactUseEffectEventOrigin = (
  symbol: SymbolDescriptor,
  scopes: ScopeAnalysis,
): boolean => {
  const initializer = symbol.initializer ? stripParenExpression(symbol.initializer) : null;
  if (!initializer || !isNodeOfType(initializer, "CallExpression")) return false;
  return isReactApiCall(initializer, "useEffectEvent", scopes, {
    allowGlobalReactNamespace: true,
    allowUnboundBareCalls: true,
  });
};
