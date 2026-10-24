import type { ScopeAnalysis, SymbolDescriptor } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { isBindingAssignmentTarget } from "./is-binding-assignment-target.js";

interface SymbolBindingWriteFacts {
  readonly program: EsTreeNode;
  readonly writesBySymbol: WeakMap<SymbolDescriptor, boolean>;
}

const bindingWriteFactsByScope = new WeakMap<ScopeAnalysis, SymbolBindingWriteFacts>();

export const hasSymbolBindingWrites = (
  symbol: SymbolDescriptor,
  scopes: ScopeAnalysis,
): boolean => {
  const program = scopes.rootScope.node;
  let facts = bindingWriteFactsByScope.get(scopes);
  if (!facts || facts.program !== program) {
    facts = { program, writesBySymbol: new WeakMap() };
    bindingWriteFactsByScope.set(scopes, facts);
  }
  const cachedWrites = facts.writesBySymbol.get(symbol);
  if (cachedWrites !== undefined) return cachedWrites;
  const hasWrites = symbol.references.some(
    (reference) => reference.flag !== "read" || isBindingAssignmentTarget(reference.identifier),
  );
  facts.writesBySymbol.set(symbol, hasWrites);
  return hasWrites;
};
