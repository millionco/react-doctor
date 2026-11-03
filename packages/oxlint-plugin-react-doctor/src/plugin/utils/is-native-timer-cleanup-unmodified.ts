import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { hasCompleteGlobalReferences } from "./has-complete-global-references.js";
import { hasCompleteSymbolReferences } from "./has-complete-symbol-references.js";
import { isNodeOfType } from "./is-node-of-type.js";
import {
  GLOBAL_SELF_PROPERTY_NAMES,
  isProvenGlobalObjectReference,
} from "./is-proven-global-namespace-reference.js";
import { hasGlobalNamespaceMemberMutation } from "./is-proven-unmodified-global-namespace-reference.js";

interface NativeTimerCleanupProofInput {
  cleanupName: string;
  program: EsTreeNode;
  scopes: ScopeAnalysis;
}

const proofsByAnalysis = new WeakMap<ScopeAnalysis, WeakMap<EsTreeNode, Map<string, boolean>>>();

export const isNativeTimerCleanupUnmodified = ({
  cleanupName,
  program,
  scopes,
}: NativeTimerCleanupProofInput): boolean => {
  let proofsByProgram = proofsByAnalysis.get(scopes);
  if (!proofsByProgram) {
    proofsByProgram = new WeakMap();
    proofsByAnalysis.set(scopes, proofsByProgram);
  }
  let proofsByName = proofsByProgram.get(program);
  if (!proofsByName) {
    proofsByName = new Map();
    proofsByProgram.set(program, proofsByName);
  }
  const cached = proofsByName.get(cleanupName);
  if (cached !== undefined) return cached;
  const evaluateProof = (): boolean => {
    if (
      !hasCompleteGlobalReferences(GLOBAL_SELF_PROPERTY_NAMES, program, scopes) ||
      !hasCompleteGlobalReferences(new Set([cleanupName]), program, scopes) ||
      hasGlobalNamespaceMemberMutation(null, scopes, cleanupName)
    )
      return false;
    const pendingScopes = [scopes.rootScope];
    while (pendingScopes.length > 0) {
      const scope = pendingScopes.pop();
      if (!scope) break;
      if (
        scope.references.some(
          (reference) =>
            isNodeOfType(reference.identifier, "Identifier") &&
            reference.identifier.name === cleanupName &&
            reference.resolvedSymbol === null &&
            reference.flag !== "read",
        ) ||
        scope.symbols.some(
          (symbol) =>
            symbol.initializer &&
            isProvenGlobalObjectReference(symbol.initializer, scopes) &&
            !hasCompleteSymbolReferences(symbol, program, scopes),
        )
      )
        return false;
      pendingScopes.push(...scope.children);
    }
    return true;
  };
  const proof = evaluateProof();
  proofsByName.set(cleanupName, proof);
  return proof;
};
