import type { EsTreeNode } from "./es-tree-node.js";
import { getSingleReturnExpression } from "./get-single-return-expression.js";
import { isFunctionLike } from "./is-function-like.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { stripParenExpression } from "./strip-paren-expression.js";

export const isIndexQuantityOption = (callback: EsTreeNode): boolean => {
  if (!isFunctionLike(callback) || callback.async || callback.generator) return false;
  const indexParameter = callback.params[1];
  if (!isNodeOfType(indexParameter, "Identifier")) return false;
  const returnedExpression = getSingleReturnExpression(callback);
  if (!returnedExpression) return false;
  const option = stripParenExpression(returnedExpression);
  if (
    !isNodeOfType(option, "JSXElement") ||
    !isNodeOfType(option.openingElement.name, "JSXIdentifier") ||
    option.openingElement.name.name !== "option"
  )
    return false;
  const getIndexOffset = (expression: EsTreeNode): number | null => {
    const value = stripParenExpression(expression);
    if (isNodeOfType(value, "Identifier") && value.name === indexParameter.name) return 0;
    if (
      isNodeOfType(value, "BinaryExpression") &&
      value.operator === "+" &&
      isNodeOfType(value.left, "Identifier") &&
      value.left.name === indexParameter.name &&
      isNodeOfType(value.right, "Literal") &&
      typeof value.right.value === "number" &&
      Number.isSafeInteger(value.right.value) &&
      value.right.value >= 0
    )
      return value.right.value;
    return null;
  };
  const attributes = option.openingElement.attributes;
  if (attributes.length !== 2) return false;
  const offsets = new Map<string, number>();
  for (const attribute of attributes) {
    if (
      !isNodeOfType(attribute, "JSXAttribute") ||
      !isNodeOfType(attribute.name, "JSXIdentifier") ||
      !["key", "value"].includes(attribute.name.name) ||
      !isNodeOfType(attribute.value, "JSXExpressionContainer")
    )
      return false;
    const offset = getIndexOffset(attribute.value.expression);
    if (offset === null) return false;
    offsets.set(attribute.name.name, offset);
  }
  const quantityOffset = offsets.get("value");
  if (quantityOffset === undefined || offsets.get("key") !== quantityOffset) return false;
  const children = option.children.filter(
    (child) => !isNodeOfType(child, "JSXText") || child.value.trim() !== "",
  );
  return (
    children.length === 1 &&
    isNodeOfType(children[0], "JSXExpressionContainer") &&
    getIndexOffset(children[0].expression) === quantityOffset
  );
};
