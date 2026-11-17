import type { ScopeDescriptor, SymbolDescriptor } from "../semantic/scope-analysis.js";
import { hasVisibleAmbientFunctionDeclaration } from "./has-visible-ambient-function-declaration.js";

const erasedTypeNameBindings = new WeakMap<SymbolDescriptor, boolean>();

export const hasOnlyErasedTypeNameBindings = (symbol: SymbolDescriptor): boolean => {
  const cached = erasedTypeNameBindings.get(symbol);
  if (cached !== undefined) return cached;
  if (hasVisibleAmbientFunctionDeclaration(symbol.scope, symbol.name)) {
    erasedTypeNameBindings.set(symbol, false);
    return false;
  }
  let scope: ScopeDescriptor | null = symbol.scope;
  while (scope) {
    if (
      scope.symbols.some(
        (candidate) =>
          candidate.name === symbol.name &&
          candidate.kind !== "ts-interface" &&
          candidate.kind !== "ts-type-alias",
      )
    ) {
      erasedTypeNameBindings.set(symbol, false);
      return false;
    }
    scope = scope.parent;
  }
  erasedTypeNameBindings.set(symbol, true);
  return true;
};
