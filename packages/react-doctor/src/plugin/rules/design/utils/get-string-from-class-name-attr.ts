import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { findJsxAttribute } from "../../../utils/find-jsx-attribute.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";

export const getStringFromClassNameAttr = (node: EsTreeNode): string | null => {
  if (!isNodeOfType(node, "JSXOpeningElement")) return null;
  const classAttr = findJsxAttribute(node.attributes ?? [], "className");
  if (!classAttr?.value) return null;
  if (isNodeOfType(classAttr.value, "Literal") && typeof classAttr.value.value === "string") {
    return classAttr.value.value;
  }
  if (
    isNodeOfType(classAttr.value, "JSXExpressionContainer") &&
    isNodeOfType(classAttr.value.expression, "Literal") &&
    typeof classAttr.value.expression.value === "string"
  ) {
    return classAttr.value.expression.value;
  }
  if (
    isNodeOfType(classAttr.value, "JSXExpressionContainer") &&
    isNodeOfType(classAttr.value.expression, "TemplateLiteral") &&
    classAttr.value.expression.quasis?.length === 1
  ) {
    return classAttr.value.expression.quasis[0].value?.raw ?? null;
  }
  return null;
};
