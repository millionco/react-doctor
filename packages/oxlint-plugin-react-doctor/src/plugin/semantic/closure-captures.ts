import type { EsTreeNode } from "../utils/es-tree-node.js";
import type { ReferenceDescriptor, ScopeAnalysis } from "./scope-analysis.js";
import { isDescendantScope } from "./scope-analysis.js";
import { TYPE_POSITION_CHILD_KEYS } from "../constants/ts-type-position-keys.js";
import { isAstDescendant } from "../utils/is-ast-descendant.js";
import { isAstNode } from "../utils/is-ast-node.js";
import { isFunctionLike } from "../utils/is-function-like.js";

// True if `inner` is a descendant of `outer` (or equal) in the AST
// tree. Used to filter references inside `functionNode`.
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
  // Use the function's OWN scope (the body scope) so references in
  // the body whose binding is in an outer (enclosing) scope are
  // counted as captured. `scopeFor(fnNode)` returns the parent scope.
  const functionScope = scopes.ownScopeFor(functionNode) ?? scopes.scopeFor(functionNode);
  const out: ReferenceDescriptor[] = [];
  const seen = new Set<number>();

  // Walk the AST descendants of functionNode, NOT the scope tree —
  // because scopeFor returns the parent scope for a function node and
  // we want references located AT OR BELOW the function.
  const visit = (node: EsTreeNode): void => {
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
      return;
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
    const record = node as unknown as Record<string, unknown>;
    for (const key of Object.keys(record)) {
      if (key === "parent") continue;
      if (TYPE_POSITION_CHILD_KEYS.has(key)) continue;
      const child = record[key];
      if (Array.isArray(child)) {
        for (const item of child) if (isAstNode(item)) visit(item);
      } else if (isAstNode(child)) {
        visit(child);
      }
    }
  };
  visit(functionNode);

  // Filter out references whose identifier is OUTSIDE functionNode in
  // the AST (defensive — shouldn't happen given our walk).
  return out.filter((reference) => isAstDescendant(reference.identifier, functionNode));
};
