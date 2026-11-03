import type { ScopeAnalysis, SymbolDescriptor } from "../semantic/scope-analysis.js";
import type { RuleContext } from "./rule-context.js";
import { hasReliableMatcherSymbolReferences } from "./has-reliable-matcher-symbol-references.js";
const readonlyProofsByAnalysis = new WeakMap<ScopeAnalysis, Map<SymbolDescriptor, boolean>>();

export const hasStableReadonlyMatcherReferences = (
  symbol: SymbolDescriptor,
  context: RuleContext,
): boolean => {
  let proofs = readonlyProofsByAnalysis.get(context.scopes);
  if (!proofs) {
    proofs = new Map();
    readonlyProofsByAnalysis.set(context.scopes, proofs);
  }
  const cached = proofs.get(symbol);
  if (cached !== undefined) return cached;
  const result =
    hasReliableMatcherSymbolReferences(symbol, context.scopes.rootScope.node, context.scopes) &&
    symbol.references.every((reference) => reference.flag === "read");
  proofs.set(symbol, result);
  return result;
};
