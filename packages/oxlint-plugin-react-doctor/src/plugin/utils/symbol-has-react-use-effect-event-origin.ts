import type { ScopeAnalysis, SymbolDescriptor } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isNonReactEffectEventCallee } from "./is-non-react-effect-event-callee.js";
import { stripParenExpression } from "./strip-paren-expression.js";

const getUseEffectEventCalleeName = (callee: EsTreeNode): string | null => {
  if (isNodeOfType(callee, "Identifier")) return callee.name;
  if (
    isNodeOfType(callee, "MemberExpression") &&
    !callee.computed &&
    isNodeOfType(callee.property, "Identifier")
  ) {
    return callee.property.name;
  }
  return null;
};

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
  if (getUseEffectEventCalleeName(initializer.callee) !== "useEffectEvent") return false;
  return !isNonReactEffectEventCallee(initializer.callee, initializer, scopes);
};
