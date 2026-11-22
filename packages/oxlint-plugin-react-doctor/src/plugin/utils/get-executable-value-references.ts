import type { ReferenceDescriptor, SymbolDescriptor } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { isNodeOfType } from "./is-node-of-type.js";

export const getExecutableValueReferences = (symbol: SymbolDescriptor): ReferenceDescriptor[] => {
  const references = new Map<EsTreeNode, ReferenceDescriptor>();
  for (const reference of symbol.references) {
    const { identifier } = reference;
    const parent = identifier.parent;
    if (
      isNodeOfType(parent, "Property") &&
      parent.shorthand &&
      !parent.computed &&
      parent.key === identifier &&
      parent.value !== identifier
    ) {
      continue;
    }
    const previous = references.get(identifier);
    if (!previous || previous.flag === "read") references.set(identifier, reference);
  }
  return Array.from(references.values());
};
