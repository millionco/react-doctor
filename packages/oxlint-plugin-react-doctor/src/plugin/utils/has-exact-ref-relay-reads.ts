import { getRuntimeSymbolReferences } from "./get-runtime-symbol-references.js";
import type { ScopeAnalysis, SymbolDescriptor } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { hasCompleteSymbolReferences } from "./has-complete-symbol-references.js";

export const hasExactRefRelayReads = (
  symbol: SymbolDescriptor,
  identifiers: ReadonlyArray<EsTreeNode>,
  program: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean =>
  hasCompleteSymbolReferences(symbol, program, scopes) &&
  getRuntimeSymbolReferences(symbol).length === identifiers.length &&
  identifiers.every((identifier) => scopes.symbolFor(identifier) === symbol) &&
  getRuntimeSymbolReferences(symbol).every(
    (reference) => reference.flag === "read" && identifiers.includes(reference.identifier),
  );
