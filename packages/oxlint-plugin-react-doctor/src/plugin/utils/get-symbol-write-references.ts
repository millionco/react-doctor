import type { ReferenceDescriptor, SymbolDescriptor } from "../semantic/scope-analysis.js";

const writeReferences = new WeakMap<SymbolDescriptor, ReadonlyArray<ReferenceDescriptor>>();

export const getSymbolWriteReferences = (
  symbol: SymbolDescriptor,
): ReadonlyArray<ReferenceDescriptor> => {
  const cached = writeReferences.get(symbol);
  if (cached) return cached;
  const references = symbol.references.filter((reference) => reference.flag !== "read");
  writeReferences.set(symbol, references);
  return references;
};
