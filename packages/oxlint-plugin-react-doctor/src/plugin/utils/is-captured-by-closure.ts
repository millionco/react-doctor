import type { ScopeDescriptor, SymbolDescriptor } from "../semantic/scope-analysis.js";

// Scope kinds that own a runtime call frame — the granularity per-function
// SSA / dataflow tracks. A binding read inside a NESTED frame is a closure
// capture those analyses can't see across, so value-flow reasoning must bail
// for it.
const FRAME_SCOPE_KINDS: ReadonlySet<string> = new Set([
  "module",
  "function",
  "arrow-function",
  "method",
]);

const enclosingFrameScope = (scope: ScopeDescriptor): ScopeDescriptor => {
  let current: ScopeDescriptor | null = scope;
  while (current) {
    if (FRAME_SCOPE_KINDS.has(current.kind)) return current;
    current = current.parent;
  }
  return scope;
};

// True when the binding is referenced from a different call frame than the
// one it's declared in (captured by a closure). SSA and definite-assignment
// stop at function boundaries, so such references are invisible to them —
// callers treat the binding conservatively to stay sound.
export const isCapturedByClosure = (symbol: SymbolDescriptor): boolean => {
  const declarationFrame = enclosingFrameScope(symbol.scope);
  return symbol.references.some(
    (reference) => enclosingFrameScope(reference.scope) !== declarationFrame,
  );
};
