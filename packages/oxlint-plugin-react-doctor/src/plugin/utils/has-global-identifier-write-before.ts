import type { ScopeAnalysis, ScopeDescriptor } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { hasRuntimeValueBinding } from "./has-runtime-value-binding.js";
import { isBindingAssignmentTarget } from "./is-binding-assignment-target.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isSymbolWriteBefore } from "./has-symbol-write-before.js";

interface IdentifierWriteFacts {
  readonly rootScope: ScopeDescriptor;
  readonly program: EsTreeNode;
  readonly writesByName: ReadonlyMap<string, ReadonlyArray<EsTreeNode>>;
}

const identifierWritesByScopes = new WeakMap<ScopeAnalysis, IdentifierWriteFacts>();

export const hasGlobalIdentifierWriteBefore = (
  identifierName: string,
  referenceNode: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  const rootScope = scopes.rootScope;
  const program = rootScope.node;
  const cachedFacts = identifierWritesByScopes.get(scopes);
  let writesByName =
    cachedFacts?.rootScope === rootScope && cachedFacts.program === program
      ? cachedFacts.writesByName
      : undefined;
  if (!writesByName) {
    const collectedWrites = new Map<string, EsTreeNode[]>();
    const pendingScopes = [rootScope];
    while (pendingScopes.length > 0) {
      const currentScope = pendingScopes.pop();
      if (!currentScope) break;
      pendingScopes.push(...currentScope.children);
      for (const reference of currentScope.references) {
        const identifier = reference.identifier;
        if (
          !isNodeOfType(identifier, "Identifier") ||
          (reference.flag === "read" && !isBindingAssignmentTarget(identifier))
        )
          continue;
        const identifiers = collectedWrites.get(identifier.name) ?? [];
        identifiers.push(identifier);
        collectedWrites.set(identifier.name, identifiers);
      }
    }
    writesByName = collectedWrites;
    identifierWritesByScopes.set(scopes, { rootScope, program, writesByName });
  }
  return (
    writesByName.get(identifierName)?.some((identifier) => {
      if (!scopes.isGlobalReference(identifier)) {
        const symbol = scopes.symbolFor(identifier);
        if (
          !symbol ||
          (symbol.kind !== "ts-interface" && symbol.kind !== "ts-type-alias") ||
          hasRuntimeValueBinding(symbol)
        )
          return false;
      }
      return isSymbolWriteBefore(identifier, referenceNode, scopes);
    }) ?? false
  );
};
