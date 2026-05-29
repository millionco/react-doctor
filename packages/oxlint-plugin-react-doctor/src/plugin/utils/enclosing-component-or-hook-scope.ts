import {
  componentOrHookDisplayNameForFunction,
  nearestEnclosingFunction,
} from "./component-or-hook-display-name.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { doesFunctionReturnsObjectLiteral } from "./function-returns-object-literal.js";
import { isReactHookName } from "./is-react-hook-name.js";
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
  // A PascalCase name alone doesn't make a function a component. Factory
  // functions (ProseMirror plugins, API adapters, query builders) are
  // routinely PascalCase but return a plain object and are called once —
  // they never re-render, so hoisting their locals is pointless and the
  // "reallocated every render" premise is false. A React component never
  // returns a plain object literal (it returns a ReactNode), so a
  // component-named function that does is a factory, not a component.
  // Hooks (`use*`) legitimately return objects (`{ data, loading }`) and
  // re-run on every render, so they pass through unchanged.
  if (!isReactHookName(displayName) && doesFunctionReturnsObjectLiteral(functionNode)) {
    return null;
  }
  const bodyScope = ownScopeFor(functionNode);
  if (!bodyScope) return null;
  return { functionNode, bodyScope, displayName };
};
