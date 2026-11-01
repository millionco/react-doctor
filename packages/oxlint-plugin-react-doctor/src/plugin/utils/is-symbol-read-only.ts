import type { SymbolDescriptor } from "../semantic/scope-analysis.js";

const readOnlyBySymbol = new WeakMap<SymbolDescriptor, boolean>();

export const isSymbolReadOnly = (symbol: SymbolDescriptor): boolean => {
  const cachedResult = readOnlyBySymbol.get(symbol);
  if (cachedResult !== undefined) return cachedResult;
  const result = symbol.references.every((reference) => reference.flag === "read");
  readOnlyBySymbol.set(symbol, result);
  return result;
};
