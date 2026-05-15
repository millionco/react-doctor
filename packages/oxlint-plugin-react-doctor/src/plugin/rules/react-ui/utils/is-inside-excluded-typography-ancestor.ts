import { TYPOGRAPHY_PUNCTUATION_EXCLUDED_TAG_NAMES } from "../../../constants/design.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { findJsxAttribute } from "../../../utils/find-jsx-attribute.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { getOpeningElementTagName } from "./get-opening-element-tag-name.js";

export const isInsideExcludedTypographyAncestor = (jsxTextNode: EsTreeNode): boolean => {
  let cursor = jsxTextNode.parent;
  while (cursor) {
    if (isNodeOfType(cursor, "JSXElement")) {
      const tagName = getOpeningElementTagName(cursor.openingElement);
      if (tagName && TYPOGRAPHY_PUNCTUATION_EXCLUDED_TAG_NAMES.has(tagName.toLowerCase())) {
        return true;
      }
      const translateAttribute = findJsxAttribute(
        cursor.openingElement?.attributes ?? [],
        "translate",
      );
      if (
        isNodeOfType(translateAttribute?.value, "Literal") &&
        translateAttribute.value.value === "no"
      ) {
        return true;
      }
    }
    cursor = cursor.parent;
  }
  return false;
};
