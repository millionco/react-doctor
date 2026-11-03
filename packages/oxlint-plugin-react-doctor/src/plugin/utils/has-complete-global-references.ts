import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { getSymbolReferenceIndex } from "./get-symbol-reference-index.js";

export const hasCompleteGlobalReferences = (
  names: ReadonlySet<string>,
  program: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  const index = getSymbolReferenceIndex(program, scopes);
  return [...names].every((name) => {
    const cached = index.globalCompleteness.get(name);
    if (cached !== undefined) return cached;
    const complete = (index.ambiguousNodes.get(name) ?? []).every((node) => {
      const reference = scopes.referenceFor(node);
      return Boolean(
        reference && reference.resolvedSymbol === null && scopes.isGlobalReference(node),
      );
    });
    index.globalCompleteness.set(name, complete);
    return complete;
  });
};
