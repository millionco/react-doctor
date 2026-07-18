import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getAuthoritativeJsxAttribute } from "../../utils/get-authoritative-jsx-attribute.js";
import { getStringLiteralAttributeValue } from "../../utils/get-string-literal-attribute-value.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { resolveJsxElementType } from "../../utils/resolve-jsx-element-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";

const getStaticNumberAttributeValue = (
  attribute: EsTreeNodeOfType<"JSXAttribute"> | null,
): number | null => {
  if (!attribute?.value) return null;
  const stringValue = getStringLiteralAttributeValue(attribute);
  if (stringValue !== null) {
    const parsedValue = Number(stringValue.trim());
    return Number.isFinite(parsedValue) ? parsedValue : null;
  }
  if (!isNodeOfType(attribute.value, "JSXExpressionContainer")) return null;
  const expression = stripParenExpression(attribute.value.expression);
  if (isNodeOfType(expression, "Literal") && typeof expression.value === "number") {
    return Number.isFinite(expression.value) ? expression.value : null;
  }
  if (
    isNodeOfType(expression, "UnaryExpression") &&
    expression.operator === "-" &&
    isNodeOfType(expression.argument, "Literal") &&
    typeof expression.argument.value === "number"
  ) {
    return -expression.argument.value;
  }
  return null;
};

const hasInvalidNativeProgressRange = (node: EsTreeNodeOfType<"JSXOpeningElement">): boolean => {
  const valueAttribute = getAuthoritativeJsxAttribute(node.attributes, "value");
  const maximumAttribute = getAuthoritativeJsxAttribute(node.attributes, "max");
  const value = getStaticNumberAttributeValue(valueAttribute);
  const maximum = maximumAttribute ? getStaticNumberAttributeValue(maximumAttribute) : 1;
  if (maximumAttribute && maximum === null) return false;
  if (maximum !== null && maximum <= 0) return true;
  return value !== null && maximum !== null && (value < 0 || value > maximum);
};

const hasInvalidAriaProgressRange = (node: EsTreeNodeOfType<"JSXOpeningElement">): boolean => {
  const minimumAttribute = getAuthoritativeJsxAttribute(node.attributes, "aria-valuemin");
  const maximumAttribute = getAuthoritativeJsxAttribute(node.attributes, "aria-valuemax");
  const currentAttribute = getAuthoritativeJsxAttribute(node.attributes, "aria-valuenow");
  const minimum = minimumAttribute ? getStaticNumberAttributeValue(minimumAttribute) : 0;
  const maximum = maximumAttribute ? getStaticNumberAttributeValue(maximumAttribute) : 100;
  const current = getStaticNumberAttributeValue(currentAttribute);
  if ((minimumAttribute && minimum === null) || (maximumAttribute && maximum === null))
    return false;
  if (minimum === null || maximum === null) return false;
  if (minimum >= maximum) return true;
  return current !== null && (current < minimum || current > maximum);
};

export const noInvalidProgressRange = defineRule({
  id: "no-invalid-progress-range",
  title: "Progress value falls outside its range",
  severity: "error",
  category: "Accessibility",
  recommendation:
    "Keep determinate progress values within a valid positive range so visual and assistive feedback report the same advancement.",
  create: (context: RuleContext) => ({
    JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
      if (node.attributes.some((attribute) => isNodeOfType(attribute, "JSXSpreadAttribute"))) {
        return;
      }
      if (resolveJsxElementType(node) === "progress") {
        if (!hasInvalidNativeProgressRange(node)) return;
        context.report({
          node,
          message:
            "This progress element has an impossible value range, so its visual state and exposed progress can disagree. Use a positive max and keep value between zero and max.",
        });
        return;
      }
      const roleAttribute = getAuthoritativeJsxAttribute(node.attributes, "role");
      if (!roleAttribute || getStringLiteralAttributeValue(roleAttribute) !== "progressbar") return;
      if (!hasInvalidAriaProgressRange(node)) return;
      context.report({
        node,
        message:
          "This progressbar exposes an impossible ARIA range. Keep aria-valuemin below aria-valuemax and aria-valuenow within that range.",
      });
    },
  }),
});
