import type { ScopeAnalysis, SymbolDescriptor } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { findEnclosingFunction } from "./find-enclosing-function.js";
import { isFunctionSynchronouslyInvokedBefore } from "./has-static-property-write-before.js";

export const hasSymbolWriteBefore = (
  symbol: SymbolDescriptor,
  referenceNode: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean =>
  symbol.references.some((reference) => {
    if (reference.flag === "read") return false;
    const writeFunction = findEnclosingFunction(reference.identifier);
    const referenceFunction = findEnclosingFunction(referenceNode);
    if (writeFunction === referenceFunction) {
      return reference.identifier.range[0] < referenceNode.range[0];
    }
    if (!writeFunction) return true;
    return isFunctionSynchronouslyInvokedBefore(writeFunction, referenceNode, scopes);
  });
