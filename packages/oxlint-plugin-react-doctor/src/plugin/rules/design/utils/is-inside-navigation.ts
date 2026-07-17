import { getStringLiteralAttributeValue } from "../../../utils/get-string-literal-attribute-value.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { hasJsxPropIgnoreCase } from "../../../utils/has-jsx-prop-ignore-case.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";

export const isInsideNavigation = (node: EsTreeNode): boolean => {
  let ancestor = node.parent;
  while (ancestor) {
    if (isNodeOfType(ancestor, "JSXElement")) {
      const openingElement = ancestor.openingElement;
      if (
        isNodeOfType(openingElement.name, "JSXIdentifier") &&
        (openingElement.name.name === "nav" || openingElement.name.name === "aside")
      ) {
        return true;
      }
      const roleAttribute = hasJsxPropIgnoreCase(openingElement.attributes, "role");
      if (
        roleAttribute &&
        getStringLiteralAttributeValue(roleAttribute)?.toLowerCase() === "navigation"
      ) {
        return true;
      }
    }
    ancestor = ancestor.parent;
  }
  return false;
};
