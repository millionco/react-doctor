import type { EsTreeNode } from "./es-tree-node.js";
import { getStaticObjectProperty } from "./get-static-object-property.js";

export const getStaticObjectPropertyValue = (
  node: EsTreeNode,
  expectedPropertyName: string,
): EsTreeNode | null | undefined => {
  const property = getStaticObjectProperty(node, expectedPropertyName);
  if (!property) return property;
  return property.kind === "init" ? property.value : null;
};
