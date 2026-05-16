import type { EsTreeNode } from "./es-tree-node.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { collectReferenceIdentifierNames } from "./collect-reference-identifier-names.js";

export const collectPatternDefaultReferenceNames = (
  pattern: EsTreeNode | null | undefined,
  into: Set<string>,
): void => {
  if (!pattern) return;
  if (isNodeOfType(pattern, "AssignmentPattern")) {
    collectReferenceIdentifierNames(pattern.right, into);
    collectPatternDefaultReferenceNames(pattern.left, into);
    return;
  }
  if (isNodeOfType(pattern, "RestElement")) {
    collectPatternDefaultReferenceNames(pattern.argument, into);
    return;
  }
  if (isNodeOfType(pattern, "ArrayPattern")) {
    for (const element of pattern.elements ?? [])
      collectPatternDefaultReferenceNames(element, into);
    return;
  }
  if (isNodeOfType(pattern, "ObjectPattern")) {
    for (const property of pattern.properties ?? []) {
      if (isNodeOfType(property, "RestElement")) {
        collectPatternDefaultReferenceNames(property.argument, into);
      } else if (isNodeOfType(property, "Property")) {
        if (property.computed) collectReferenceIdentifierNames(property.key, into);
        collectPatternDefaultReferenceNames(property.value, into);
      }
    }
  }
};
