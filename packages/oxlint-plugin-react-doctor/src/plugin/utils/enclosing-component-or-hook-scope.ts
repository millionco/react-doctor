import {
  componentOrHookDisplayNameForFunction,
  nearestEnclosingFunction,
} from "./component-or-hook-display-name.js";
import type { EsTreeNode } from "./es-tree-node.js";
import type { ScopeAnalysis, ScopeDescriptor } from "../semantic/scope-analysis.js";

export interface EnclosingComponentInfo {
  readonly functionNode: EsTreeNode;
  readonly bodyScope: ScopeDescriptor;
  readonly displayName: string;
}

// Scope-aware sibling of `enclosingComponentOrHookName`. Walks to the
// nearest enclosing function and, when that function is a React
// component (PascalCase) or hook (`use*`), returns its body scope so
// callers can run scope queries (closureCaptures, isDescendantScope,
// …) against the component boundary.
//
// Stops at the first function boundary for the same reason as the name
// variant: a binding declared inside a nested callback (event handler,
// useMemo / useCallback body) isn't a per-render allocation of the
// component, so it shouldn't be attributed to it.
//
// Used by `prefer-module-scope-pure-function` and
// `prefer-module-scope-static-value`.
export const enclosingComponentOrHookScope = (
  startNode: EsTreeNode,
  ownScopeFor: ScopeAnalysis["ownScopeFor"],
): EnclosingComponentInfo | null => {
  const functionNode = nearestEnclosingFunction(startNode);
  if (!functionNode) return null;
  const displayName = componentOrHookDisplayNameForFunction(functionNode);
  if (!displayName) return null;
  const bodyScope = ownScopeFor(functionNode);
  if (!bodyScope) return null;
  return { functionNode, bodyScope, displayName };
};
