import type { EsTreeNode } from "./es-tree-node.js";
import { getStaticPropertyKeyName } from "./get-static-property-key-name.js";
import { isNodeOfType } from "./is-node-of-type.js";

export const getDestructuredBindingPropertyName = (
  bindingIdentifier: EsTreeNode,
): string | null => {
  let bindingNode = bindingIdentifier;
  if (
    isNodeOfType(bindingNode.parent, "AssignmentPattern") &&
    bindingNode.parent.left === bindingNode
  ) {
    bindingNode = bindingNode.parent;
  }
  const property = bindingNode.parent;
  if (
    !property ||
    !isNodeOfType(property, "Property") ||
    property.value !== bindingNode ||
    !property.parent ||
    !isNodeOfType(property.parent, "ObjectPattern")
  ) {
    return null;
  }
  return getStaticPropertyKeyName(property, { allowComputedString: true });
};
