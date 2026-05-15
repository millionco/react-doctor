import {
  HEADING_TAG_NAMES,
  HEAVY_HEADING_FONT_WEIGHT_MIN,
  HEAVY_HEADING_TAILWIND_WEIGHTS,
} from "../../constants/design.js";
import { defineRule } from "../../utils/define-rule.js";
import { findJsxAttribute } from "../../utils/find-jsx-attribute.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { getOpeningElementTagName } from "./utils/get-opening-element-tag-name.js";
import { getClassNameLiteral } from "./utils/get-class-name-literal.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

const getInlineStyleObjectExpression = (
  jsxAttribute: EsTreeNode,
): EsTreeNodeOfType<"ObjectExpression"> | null => {
  if (!isNodeOfType(jsxAttribute, "JSXAttribute")) return null;
  if (!isNodeOfType(jsxAttribute.name, "JSXIdentifier") || jsxAttribute.name.name !== "style") {
    return null;
  }
  if (!isNodeOfType(jsxAttribute.value, "JSXExpressionContainer")) return null;
  const expression = jsxAttribute.value.expression;
  if (!isNodeOfType(expression, "ObjectExpression")) return null;
  return expression;
};

const getStylePropertyKeyName = (objectProperty: EsTreeNode): string | null => {
  if (!isNodeOfType(objectProperty, "Property")) return null;
  if (isNodeOfType(objectProperty.key, "Identifier")) return objectProperty.key.name;
  if (isNodeOfType(objectProperty.key, "Literal") && typeof objectProperty.key.value === "string") {
    return objectProperty.key.value;
  }
  return null;
};

const getStylePropertyNumericValue = (objectProperty: EsTreeNode): number | null => {
  if (!isNodeOfType(objectProperty, "Property")) return null;
  const valueNode = objectProperty.value;
  if (!valueNode) return null;
  if (isNodeOfType(valueNode, "Literal") && typeof valueNode.value === "number")
    return valueNode.value;
  if (isNodeOfType(valueNode, "Literal") && typeof valueNode.value === "string") {
    const parsed = parseFloat(valueNode.value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

export const noBoldHeading = defineRule<Rule>({
  id: "design-no-bold-heading",
  tags: ["design", "test-noise"],
  severity: "warn",
  category: "Architecture",
  recommendation:
    "Use `font-semibold` (600) or `font-medium` (500) on headings — 700+ crushes letter counter shapes at display sizes",
  create: (context: RuleContext) => ({
    JSXOpeningElement(openingNode: EsTreeNodeOfType<"JSXOpeningElement">) {
      const tagName = getOpeningElementTagName(openingNode);
      if (!tagName || !HEADING_TAG_NAMES.has(tagName)) return;

      const classAttribute = findJsxAttribute(openingNode.attributes ?? [], "className");
      if (classAttribute) {
        const classNameLiteral = getClassNameLiteral(classAttribute);
        if (classNameLiteral) {
          for (const tailwindWeightToken of HEAVY_HEADING_TAILWIND_WEIGHTS) {
            const tokenPattern = new RegExp(`(?:^|\\s)${tailwindWeightToken}(?:$|\\s|:)`);
            if (tokenPattern.test(classNameLiteral)) {
              context.report({
                node: classAttribute,
                message: `${tailwindWeightToken} on <${tagName}> crushes counter shapes at display sizes — use font-semibold (600) or font-medium (500)`,
              });
              return;
            }
          }
        }
      }

      const styleAttribute = findJsxAttribute(openingNode.attributes ?? [], "style");
      if (!styleAttribute) return;
      const styleObject = getInlineStyleObjectExpression(styleAttribute);
      if (!styleObject) return;

      for (const objectProperty of styleObject.properties ?? []) {
        const stylePropertyName = getStylePropertyKeyName(objectProperty);
        if (stylePropertyName !== "fontWeight") continue;
        const numericWeight = getStylePropertyNumericValue(objectProperty);
        if (numericWeight !== null && numericWeight >= HEAVY_HEADING_FONT_WEIGHT_MIN) {
          context.report({
            node: objectProperty,
            message: `fontWeight: ${numericWeight} on <${tagName}> crushes counter shapes at display sizes — use 500 or 600`,
          });
          return;
        }
      }
    },
  }),
});
