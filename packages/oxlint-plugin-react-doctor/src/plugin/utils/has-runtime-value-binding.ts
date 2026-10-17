import type { ScopeDescriptor, SymbolDescriptor } from "../semantic/scope-analysis.js";
import { isErasedTypeScriptBinding } from "./is-erased-typescript-binding.js";

const runtimeValueBindings = new WeakMap<SymbolDescriptor, boolean>();

export const hasRuntimeValueBinding = (symbol: SymbolDescriptor): boolean => {
  const cached = runtimeValueBindings.get(symbol);
  if (cached !== undefined) return cached;
  let scope: ScopeDescriptor | null = symbol.scope;
  while (scope) {
    if (
      scope.symbols.some(
        (candidate) => candidate.name === symbol.name && !isErasedTypeScriptBinding(candidate),
      )
    ) {
      runtimeValueBindings.set(symbol, true);
      return true;
    }
    scope = scope.parent;
  }
  runtimeValueBindings.set(symbol, false);
  return false;
};
