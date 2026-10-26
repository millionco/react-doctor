import type { ScopeAnalysis, SymbolDescriptor } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";

export interface ReactProviderProofCache {
  readonly readonlyJsxProperties: Map<string, boolean>;
  readonly namespaceApiCalls: Map<string, boolean>;
  readonly namedApiCalls: WeakMap<SymbolDescriptor, boolean>;
  readonly defaultProviderMutations: Map<string, boolean>;
}

interface ScopedReactProviderProofCache {
  readonly program: EsTreeNode;
  readonly cache: ReactProviderProofCache;
}

const providerProofsByScopes = new WeakMap<ScopeAnalysis, ScopedReactProviderProofCache>();

export const getReactProviderProofCache = (scopes: ScopeAnalysis): ReactProviderProofCache => {
  const program = scopes.rootScope.node;
  const cached = providerProofsByScopes.get(scopes);
  if (cached?.program === program) return cached.cache;
  const cache: ReactProviderProofCache = {
    readonlyJsxProperties: new Map(),
    namespaceApiCalls: new Map(),
    namedApiCalls: new WeakMap(),
    defaultProviderMutations: new Map(),
  };
  providerProofsByScopes.set(scopes, { program, cache });
  return cache;
};
