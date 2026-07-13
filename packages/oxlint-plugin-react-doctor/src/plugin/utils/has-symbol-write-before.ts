import type { SymbolDescriptor } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";

export const hasSymbolWriteBefore = (
  symbol: SymbolDescriptor,
  referenceNode: EsTreeNode,
): boolean =>
  symbol.references.some(
    (reference) =>
      reference.flag !== "read" &&
      (reference.scope !== symbol.scope || reference.identifier.range[0] < referenceNode.range[0]),
  );
