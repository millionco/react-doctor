import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";
import { getAuthoritativeJsxAttribute } from "../../../utils/get-authoritative-jsx-attribute.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isNullishExpression } from "../../../utils/is-nullish-expression.js";
import type { RuleContext } from "../../../utils/rule-context.js";
import { getJsxAttributeExpression } from "./get-jsx-attribute-expression.js";
import { getStaticNumber } from "./get-static-number.js";
import { isR3fCanvas } from "./is-r3f-canvas.js";
import { isR3fHostIntrinsic } from "./is-r3f-host-intrinsic.js";
import { readStaticJsxBooleanAttribute } from "./read-static-jsx-boolean-attribute.js";

const getElementVisibility = (node: EsTreeNodeOfType<"JSXOpeningElement">): boolean | null => {
  if (node.attributes.some((attribute) => isNodeOfType(attribute, "JSXSpreadAttribute"))) {
    return null;
  }
  const visibleAttribute = getAuthoritativeJsxAttribute(node.attributes, "visible");
  return visibleAttribute ? readStaticJsxBooleanAttribute(visibleAttribute) : true;
};

const getMaterialVisibility = (
  node: EsTreeNodeOfType<"JSXOpeningElement">,
  context: RuleContext,
): boolean | null => {
  const elementVisibility = getElementVisibility(node);
  if (elementVisibility !== true) return elementVisibility;
  const transparentAttribute = getAuthoritativeJsxAttribute(node.attributes, "transparent");
  if (!transparentAttribute) return true;
  const isTransparent = readStaticJsxBooleanAttribute(transparentAttribute);
  if (isTransparent === false) return true;
  if (isTransparent === null) return null;
  const opacityExpression = getJsxAttributeExpression(node, "opacity");
  if (opacityExpression === undefined || opacityExpression === null) return true;
  if (isNullishExpression(opacityExpression)) return true;
  const opacity = getStaticNumber(opacityExpression, context.scopes);
  return opacity === null ? null : opacity > 0;
};

export const getR3fSurfaceVisibility = (
  mesh: EsTreeNodeOfType<"JSXElement">,
  material: EsTreeNodeOfType<"JSXOpeningElement">,
  context: RuleContext,
): boolean | null => {
  const materialVisibility = getMaterialVisibility(material, context);
  if (materialVisibility !== true) return materialVisibility;
  let current: EsTreeNode | null = mesh;
  while (current) {
    if (isNodeOfType(current, "JSXElement")) {
      if (current !== mesh && isR3fCanvas(current.openingElement, context)) return true;
      if (!isR3fHostIntrinsic(current.openingElement)) return null;
      const elementVisibility = getElementVisibility(current.openingElement);
      if (elementVisibility !== true) return elementVisibility;
    }
    current = current.parent ?? null;
  }
  return true;
};
