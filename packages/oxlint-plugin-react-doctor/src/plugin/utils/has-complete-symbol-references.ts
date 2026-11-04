import type { ScopeAnalysis, SymbolDescriptor } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { getSymbolReferenceIndex } from "./get-symbol-reference-index.js";

const hasRuntimeTypeScriptAncestor = (node: EsTreeNode): boolean => {
  let ancestor = node.parent;
  while (ancestor?.type.startsWith("TS")) {
    if (
      ancestor.type === "TSParameterProperty" ||
      ancestor.type === "TSImportEqualsDeclaration" ||
      ancestor.type === "TSExportAssignment" ||
      ancestor.type === "TSEnumMember" ||
      ancestor.type === "TSEnumDeclaration" ||
      ancestor.type === "TSModuleDeclaration"
    )
      return true;
    ancestor = ancestor.parent;
  }
  return false;
};

export const hasCompleteSymbolReferences = (
  symbol: SymbolDescriptor,
  program: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  const index = getSymbolReferenceIndex(program, scopes);
  const cached = index.completeness.get(symbol);
  if (cached !== undefined) return cached;
  const references = new Set(symbol.references);
  const isComplete = [
    index.resolvedNodes.get(symbol) ?? [],
    index.ambiguousNodes.get(symbol.name) ?? [],
  ].every((nodes) =>
    nodes.every((node) => {
      if (node === symbol.bindingIdentifier || node.name !== symbol.name) return true;
      const reference = scopes.referenceFor(node);
      return Boolean(
        !hasRuntimeTypeScriptAncestor(node) &&
        reference &&
        scopes.symbolFor(node) === symbol &&
        reference.resolvedSymbol === symbol &&
        references.has(reference),
      );
    }),
  );
  index.completeness.set(symbol, isComplete);
  return isComplete;
};
