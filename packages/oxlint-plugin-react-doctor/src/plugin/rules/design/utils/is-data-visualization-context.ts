import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { getStringFromClassNameAttr } from "./get-string-from-class-name-attr.js";

const DATA_VISUALIZATION_NAME_PATTERN =
  /(?:^|[-_\s/.])(?:blueprint|breakdown|canvas|chart|distribution|graph|map|plot|visualization)(?:[-_\s/.]|$)/i;

const normalizeDataVisualizationName = (value: string): string =>
  value.replace(/([a-z\d])([A-Z])/g, "$1-$2");

const isDataVisualizationElement = (node: EsTreeNodeOfType<"JSXOpeningElement">): boolean => {
  const elementName = isNodeOfType(node.name, "JSXIdentifier") ? node.name.name : "";
  const classNameValue = getStringFromClassNameAttr(node) ?? "";
  return (
    DATA_VISUALIZATION_NAME_PATTERN.test(normalizeDataVisualizationName(elementName)) ||
    DATA_VISUALIZATION_NAME_PATTERN.test(classNameValue)
  );
};

export const isDataVisualizationContext = (
  node: EsTreeNodeOfType<"JSXOpeningElement">,
  filename?: string,
): boolean => {
  if (
    (filename && DATA_VISUALIZATION_NAME_PATTERN.test(normalizeDataVisualizationName(filename))) ||
    isDataVisualizationElement(node)
  ) {
    return true;
  }
  let ancestor = node.parent;
  while (ancestor) {
    if (
      isNodeOfType(ancestor, "JSXElement") &&
      isDataVisualizationElement(ancestor.openingElement)
    ) {
      return true;
    }
    ancestor = ancestor.parent;
  }
  return false;
};
