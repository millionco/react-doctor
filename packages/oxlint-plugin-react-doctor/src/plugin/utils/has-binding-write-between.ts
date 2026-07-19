import type {
  ReferenceDescriptor,
  ScopeAnalysis,
  SymbolDescriptor,
} from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { findDeferredExecutionBoundary } from "./find-deferred-execution-boundary.js";

const writeReferencesBySymbol = new WeakMap<SymbolDescriptor, readonly ReferenceDescriptor[]>();

const getWriteReferences = (symbol: SymbolDescriptor): readonly ReferenceDescriptor[] => {
  const cachedReferences = writeReferencesBySymbol.get(symbol);
  if (cachedReferences) return cachedReferences;
  const writeReferences = symbol.references.filter((reference) => reference.flag !== "read");
  writeReferencesBySymbol.set(symbol, writeReferences);
  return writeReferences;
};

export const hasBindingWriteBetween = (
  identifier: EsTreeNodeOfType<"Identifier">,
  startNode: EsTreeNode | null,
  endNode: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  const symbol = scopes.symbolFor(identifier);
  if (!symbol) return false;
  const startOffset = startNode?.range[1] ?? Number.NEGATIVE_INFINITY;
  const writeReferences = getWriteReferences(symbol);
  let lowerIndex = 0;
  let upperIndex = writeReferences.length;
  while (lowerIndex < upperIndex) {
    const middleIndex = Math.floor((lowerIndex + upperIndex) / 2);
    if (writeReferences[middleIndex]!.identifier.range[0] <= startOffset) {
      lowerIndex = middleIndex + 1;
    } else {
      upperIndex = middleIndex;
    }
  }
  const executionBoundary = findDeferredExecutionBoundary(endNode);
  for (
    let referenceIndex = lowerIndex;
    referenceIndex < writeReferences.length;
    referenceIndex += 1
  ) {
    const reference = writeReferences[referenceIndex]!;
    if (reference.identifier.range[0] >= endNode.range[0]) return false;
    if (findDeferredExecutionBoundary(reference.identifier) === executionBoundary) return true;
  }
  return false;
};
