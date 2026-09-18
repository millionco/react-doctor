import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { isNodeOfType } from "./is-node-of-type.js";

export const hasJsxKeyAttribute = (
  openingElement: EsTreeNodeOfType<"JSXOpeningElement">,
): boolean => {
  for (const attribute of openingElement.attributes) {
    if (!isNodeOfType(attribute, "JSXAttribute")) continue;
    if (!isNodeOfType(attribute.name, "JSXIdentifier")) continue;
    if (attribute.name.name === "key") return true;
  }
  return false;
};
