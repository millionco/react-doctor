import type { SymbolDescriptor } from "../../../semantic/scope-analysis.js";
import { isWithinAssignmentTarget } from "../../../utils/is-within-assignment-target.js";

const readonlyBindings = new WeakMap<SymbolDescriptor, boolean>();

export const isReadonlyCallbackMapSymbol = (symbol: SymbolDescriptor): boolean => {
  const cached = readonlyBindings.get(symbol);
  if (cached !== undefined) return cached;
  const readonly = symbol.references.every(
    (reference) => reference.flag === "read" && !isWithinAssignmentTarget(reference.identifier),
  );
  readonlyBindings.set(symbol, readonly);
  return readonly;
};
