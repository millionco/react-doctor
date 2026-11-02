import type { ScopeDescriptor, SymbolDescriptor } from "../semantic/scope-analysis.js";
import { hasVisibleAmbientFunctionDeclaration } from "./has-visible-ambient-function-declaration.js";

export const hasOnlyErasedTypeNameBindings = (symbol: SymbolDescriptor): boolean => {
  if (hasVisibleAmbientFunctionDeclaration(symbol.scope, symbol.name)) return false;
  let scope: ScopeDescriptor | null = symbol.scope;
  while (scope) {
    if (
      scope.symbols.some(
        (candidate) =>
          candidate.name === symbol.name &&
          candidate.kind !== "ts-interface" &&
          candidate.kind !== "ts-type-alias",
      )
    )
      return false;
    scope = scope.parent;
  }
  return true;
};
