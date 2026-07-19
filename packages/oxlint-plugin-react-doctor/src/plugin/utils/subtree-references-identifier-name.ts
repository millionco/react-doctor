import type { EsTreeNode } from "./es-tree-node.js";
import { collectReferenceIdentifierNames } from "./collect-reference-identifier-names.js";

export const subtreeReferencesIdentifierName = (
  node: EsTreeNode | null | undefined,
  names: string | ReadonlySet<string>,
): boolean => {
  if (!node) return false;
  const referencedNames = new Set<string>();
  collectReferenceIdentifierNames(node, referencedNames);
  if (typeof names === "string") return referencedNames.has(names);
  for (const name of names) {
    if (referencedNames.has(name)) return true;
  }
  return false;
};
