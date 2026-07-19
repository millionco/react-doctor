import { HTML_TAGS } from "../../../constants/html-tags.js";
import { SVG_TAGS } from "../../../constants/svg-tags.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { resolveJsxElementType } from "../../../utils/resolve-jsx-element-type.js";

const isNestedInSvg = (node: EsTreeNode): boolean => {
  let current = node.parent ?? null;
  while (current) {
    if (
      isNodeOfType(current, "JSXElement") &&
      isNodeOfType(current.openingElement.name, "JSXIdentifier") &&
      current.openingElement.name.name === "svg"
    ) {
      return true;
    }
    current = current.parent ?? null;
  }
  return false;
};

export const isR3fHostIntrinsic = (node: EsTreeNodeOfType<"JSXOpeningElement">): boolean => {
  const elementType = resolveJsxElementType(node);
  return Boolean(
    elementType &&
    elementType[0] === elementType[0]?.toLowerCase() &&
    !elementType.includes("-") &&
    !HTML_TAGS.has(elementType) &&
    (!SVG_TAGS.has(elementType) || (elementType === "line" && !isNestedInSvg(node))),
  );
};
