import { HTML_TAGS } from "../../../constants/html-tags.js";
import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";
import { findTransparentExpressionRoot } from "../../../utils/find-transparent-expression-root.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";

export const getImageRenderParentElement = (
  openingElement: EsTreeNodeOfType<"JSXOpeningElement">,
): EsTreeNodeOfType<"JSXElement"> | null => {
  const imageElement = openingElement.parent;
  if (!isNodeOfType(imageElement, "JSXElement")) return null;
  if (isNodeOfType(imageElement.parent, "JSXElement")) return imageElement.parent;
  const imageExpression = findTransparentExpressionRoot(imageElement);
  const conditional = imageExpression.parent;
  if (
    !isNodeOfType(conditional, "ConditionalExpression") ||
    (conditional.consequent !== imageExpression && conditional.alternate !== imageExpression)
  )
    return null;
  const conditionalExpression = findTransparentExpressionRoot(conditional);
  const container = conditionalExpression.parent;
  if (
    !isNodeOfType(container, "JSXExpressionContainer") ||
    container.expression !== conditionalExpression
  )
    return null;
  const parentElement = container.parent;
  if (
    !isNodeOfType(parentElement, "JSXElement") ||
    !parentElement.children.some((child) => child === container) ||
    !isNodeOfType(parentElement.openingElement.name, "JSXIdentifier") ||
    !HTML_TAGS.has(parentElement.openingElement.name.name)
  )
    return null;
  return parentElement;
};
