import type { ScopeAnalysis } from "../../semantic/scope-analysis.js";
import type { EsTreeNodeOfType } from "../es-tree-node-of-type.js";
import { hasOnlyErasedTypeNameBindings } from "../has-only-erased-type-name-bindings.js";
import { hasVisibleAmbientFunctionDeclaration } from "../has-visible-ambient-function-declaration.js";

export const isNativeProviderReference = (
  identifier: EsTreeNodeOfType<"Identifier">,
  scopes: ScopeAnalysis,
): boolean => {
  if (hasVisibleAmbientFunctionDeclaration(scopes.scopeFor(identifier), identifier.name))
    return false;
  if (scopes.isGlobalReference(identifier)) return true;
  const symbol = scopes.symbolFor(identifier);
  return Boolean(
    symbol &&
    (symbol.kind === "ts-interface" || symbol.kind === "ts-type-alias") &&
    hasOnlyErasedTypeNameBindings(symbol),
  );
};
