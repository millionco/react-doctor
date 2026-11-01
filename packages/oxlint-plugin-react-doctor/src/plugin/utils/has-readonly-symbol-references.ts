import type { SymbolDescriptor } from "../semantic/scope-analysis.js";
import { isWithinAssignmentTarget } from "./is-within-assignment-target.js";

const readonlySymbolReferences = new WeakMap<SymbolDescriptor, boolean>();

export const hasReadonlySymbolReferences = (symbol: SymbolDescriptor): boolean => {
  let hasReadonlyReferences = readonlySymbolReferences.get(symbol);
  if (hasReadonlyReferences === undefined) {
    hasReadonlyReferences = symbol.references.every(
      (reference) => reference.flag === "read" && !isWithinAssignmentTarget(reference.identifier),
    );
    readonlySymbolReferences.set(symbol, hasReadonlyReferences);
  }
  return hasReadonlyReferences;
};
