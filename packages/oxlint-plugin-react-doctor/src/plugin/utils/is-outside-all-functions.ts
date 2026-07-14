import type { SymbolDescriptor } from "../semantic/scope-analysis.js";

const FUNCTION_SCOPE_KINDS: ReadonlySet<string> = new Set(["function", "arrow-function", "method"]);

export const isOutsideAllFunctions = (symbol: SymbolDescriptor): boolean => {
  let scope: SymbolDescriptor["scope"] | null = symbol.scope;
  while (scope) {
    if (FUNCTION_SCOPE_KINDS.has(scope.kind)) return false;
    if (scope.kind === "module") return true;
    scope = scope.parent;
  }
  return true;
};
