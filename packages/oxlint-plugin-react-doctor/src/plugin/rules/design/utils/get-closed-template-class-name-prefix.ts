import {
  CLOSED_CLASS_TEMPLATE_EXPRESSION_COUNT,
  CLOSED_CLASS_TEMPLATE_QUASI_COUNT,
} from "../../../constants/tailwind.js";
import { getAuthoritativeJsxAttribute } from "../../../utils/get-authoritative-jsx-attribute.js";
import { getTailwindTopLevelCharacterIndices } from "../../../utils/get-tailwind-top-level-character-indices.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";

export const getClosedTemplateClassNamePrefix = (node: EsTreeNode): string | null => {
  if (!isNodeOfType(node, "JSXOpeningElement")) return null;
  const attribute = getAuthoritativeJsxAttribute(node.attributes, "className");
  if (!isNodeOfType(attribute?.value, "JSXExpressionContainer")) return null;
  const expression = stripParenExpression(attribute.value.expression);
  if (
    !isNodeOfType(expression, "TemplateLiteral") ||
    expression.expressions.length !== CLOSED_CLASS_TEMPLATE_EXPRESSION_COUNT ||
    expression.quasis.length !== CLOSED_CLASS_TEMPLATE_QUASI_COUNT
  ) {
    return null;
  }
  const [interpolation] = expression.expressions;
  if (!interpolation) return null;
  const conditional = stripParenExpression(interpolation);
  if (!isNodeOfType(conditional, "ConditionalExpression")) return null;
  const consequent = stripParenExpression(conditional.consequent);
  const alternate = stripParenExpression(conditional.alternate);
  if (
    !isNodeOfType(consequent, "Literal") ||
    typeof consequent.value !== "string" ||
    !isNodeOfType(alternate, "Literal") ||
    typeof alternate.value !== "string"
  ) {
    return null;
  }
  const prefix = expression.quasis[0]?.value.cooked;
  if (typeof prefix !== "string" || /[^\S\t\n\f\r ]/.test(prefix)) return null;
  const trailingWhitespaceIndex = getTailwindTopLevelCharacterIndices(prefix, (character) =>
    /[\t\n\f\r ]/.test(character),
  ).pop();
  return trailingWhitespaceIndex !== undefined &&
    prefix.slice(trailingWhitespaceIndex).trim() === ""
    ? prefix
    : null;
};
