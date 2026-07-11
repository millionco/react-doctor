import type { EsTreeNode } from "../utils/es-tree-node.js";
import type { ReferenceDescriptor, ScopeAnalysis } from "./scope-analysis.js";
import { isDescendantScope } from "./scope-analysis.js";
import { isFunctionLike } from "../utils/is-function-like.js";
import { walkAst } from "../utils/walk-ast.js";

const computeClosureCaptures = (
  functionNode: EsTreeNode,
  scopes: ScopeAnalysis,
): ReadonlyArray<ReferenceDescriptor> => {
  // Use the function's OWN scope (the body scope) so references in
  // the body whose binding is in an outer (enclosing) scope are
  // counted as captured. `scopeFor(fnNode)` returns the parent scope.
  const functionScope = scopes.ownScopeFor(functionNode) ?? scopes.scopeFor(functionNode);
  const out: ReferenceDescriptor[] = [];
  const seen = new Set<number>();

  // Walk the AST descendants of functionNode, NOT the scope tree —
  // because scopeFor returns the parent scope for a function node and
  // we want references located AT OR BELOW the function.
  walkAst(functionNode, (node: EsTreeNode): boolean | void => {
    if (node !== functionNode && isFunctionLike(node)) {
      // Recurse into inner functions — their captures bubble up too if
      // their resolution is outside `functionNode`'s scope.
      const innerCaptures = closureCaptures(node, scopes);
      for (const reference of innerCaptures) {
        if (
          reference.resolvedSymbol &&
          !isDescendantScope(reference.resolvedSymbol.scope, functionScope)
        ) {
          if (!seen.has(reference.id)) {
            out.push(reference);
            seen.add(reference.id);
          }
        }
      }
      return false;
    }
    const reference = scopes.referenceFor(node);
    if (reference && reference.resolvedSymbol) {
      // Resolution is outside our function scope → captured.
      if (!isDescendantScope(reference.resolvedSymbol.scope, functionScope)) {
        if (!seen.has(reference.id)) {
          out.push(reference);
          seen.add(reference.id);
        }
      }
    }
  });

  // Every collected reference's identifier IS a walked descendant of
  // `functionNode` (`referenceFor` is keyed by the identifier node, and
  // bubbled inner captures sit inside inner subtrees), so no
  // containment re-check is needed here.
  return out;
};

// Memoized per (ScopeAnalysis, function node). The walk recurses into
// inner functions through this entry point, so nested callbacks compute
// once and every enclosing function — and every calling rule — reuses
// the shared frozen-by-convention array (`ReadonlyArray`, callers only
// iterate). Keyed on the ScopeAnalysis first because the semantic-
// context fallback can mint throwaway stub analyses for the same AST.
const capturesByAnalysis = new WeakMap<
  ScopeAnalysis,
  WeakMap<EsTreeNode, ReadonlyArray<ReferenceDescriptor>>
>();

// Returns every reference inside `functionNode`'s body whose binding
// lives OUTSIDE the function — i.e. the closure-captured set. Useful
// for exhaustive-deps to compute the actual set of values a hook
// callback closes over.
//
// Excludes: globals (unresolved references), references whose binding
// is the function itself (recursive call) or its parameters /
// internal locals.
export const closureCaptures = (
  functionNode: EsTreeNode,
  scopes: ScopeAnalysis,
): ReadonlyArray<ReferenceDescriptor> => {
  let capturesByFunction = capturesByAnalysis.get(scopes);
  if (!capturesByFunction) {
    capturesByFunction = new WeakMap();
    capturesByAnalysis.set(scopes, capturesByFunction);
  }
  const memoizedCaptures = capturesByFunction.get(functionNode);
  if (memoizedCaptures) return memoizedCaptures;
  const computedCaptures = computeClosureCaptures(functionNode, scopes);
  capturesByFunction.set(functionNode, computedCaptures);
  return computedCaptures;
};
