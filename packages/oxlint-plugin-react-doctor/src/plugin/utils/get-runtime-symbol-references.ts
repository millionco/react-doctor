import type { ReferenceDescriptor, SymbolDescriptor } from "../semantic/scope-analysis.js";
import { isKeyedDraftTypeReference } from "./is-keyed-draft-type-reference.js";

const runtimeReferencesBySymbol = new WeakMap<
  SymbolDescriptor,
  ReadonlyArray<ReferenceDescriptor>
>();

export const getRuntimeSymbolReferences = (
  symbol: SymbolDescriptor,
): ReadonlyArray<ReferenceDescriptor> => {
  const cached = runtimeReferencesBySymbol.get(symbol);
  if (cached) return cached;
  const references = symbol.references.filter(
    (reference) => !isKeyedDraftTypeReference(reference.identifier),
  );
  runtimeReferencesBySymbol.set(symbol, references);
  return references;
};
