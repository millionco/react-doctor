import type { SymbolDescriptor } from "../semantic/scope-analysis.js";
import { isWithinAssignmentTarget } from "./is-within-assignment-target.js";

export const hasOnlyReadonlySymbolReferences = (symbol: SymbolDescriptor): boolean =>
  symbol.references.every(
    (reference) => reference.flag === "read" && !isWithinAssignmentTarget(reference.identifier),
  );
