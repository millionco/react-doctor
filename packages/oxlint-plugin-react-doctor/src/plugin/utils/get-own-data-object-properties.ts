import type { EsTreeNode } from "./es-tree-node.js";
import { getStaticPropertyKeyName } from "./get-static-property-key-name.js";
import { isNodeOfType } from "./is-node-of-type.js";

export const getOwnDataObjectProperties = (node: EsTreeNode): Map<string, EsTreeNode> | null => {
  if (!isNodeOfType(node, "ObjectExpression")) return null;
  const properties = new Map<string, EsTreeNode>();
  for (const property of node.properties) {
    if (
      !isNodeOfType(property, "Property") ||
      property.computed ||
      property.method ||
      property.kind !== "init"
    )
      return null;
    const name = getStaticPropertyKeyName(property);
    if (!name || name === "__proto__" || properties.has(name)) return null;
    properties.set(name, property.value);
  }
  return properties;
};
