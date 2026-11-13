import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";
import { getJsxAttributeName } from "../../../utils/get-jsx-attribute-name.js";
import { getJsxPropStringValue } from "../../../utils/get-jsx-prop-string-value.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { readStaticBoolean } from "../../../utils/read-static-boolean.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import { SINGLE_SELECT_DISPLAY_SIZE_ROWS } from "./constants.js";

const RELEVANT_SELECT_ATTRIBUTE_NAMES = new Set(["role", "multiple", "size", "aria-autocomplete"]);

export const isSingleSelectAutocompleteNone = (
  node: EsTreeNodeOfType<"JSXOpeningElement">,
): boolean => {
  if (!isNodeOfType(node.name, "JSXIdentifier") || node.name.name !== "select") return false;
  const seenRelevantNames = new Set<string>();
  let autocompleteAttribute: EsTreeNodeOfType<"JSXAttribute"> | undefined;
  for (const attribute of node.attributes) {
    if (isNodeOfType(attribute, "JSXSpreadAttribute")) return false;
    if (!isNodeOfType(attribute, "JSXAttribute")) continue;
    const name = getJsxAttributeName(attribute.name);
    if (!name || !RELEVANT_SELECT_ATTRIBUTE_NAMES.has(name.toLowerCase())) continue;
    if (name !== name.toLowerCase() || seenRelevantNames.has(name)) return false;
    seenRelevantNames.add(name);
    if (name === "role") return false;
    if (name === "aria-autocomplete") {
      autocompleteAttribute = attribute;
      continue;
    }
    const attributeValue = attribute.value;
    if (!isNodeOfType(attributeValue, "JSXExpressionContainer")) return false;
    if (name === "multiple") {
      if (readStaticBoolean(attributeValue.expression) !== false) return false;
      continue;
    }
    const value = stripParenExpression(attributeValue.expression);
    if (!isNodeOfType(value, "Literal") || value.value !== SINGLE_SELECT_DISPLAY_SIZE_ROWS)
      return false;
  }
  if (!autocompleteAttribute) return false;
  if (getJsxPropStringValue(autocompleteAttribute) === "none") return true;
  const attributeValue = autocompleteAttribute.value;
  if (!isNodeOfType(attributeValue, "JSXExpressionContainer")) return false;
  const value = stripParenExpression(attributeValue.expression);
  return isNodeOfType(value, "Literal") && value.value === "none";
};
