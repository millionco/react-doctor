import { WIDE_TRACKING_THRESHOLD_EM } from "../../constants/design.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { getInlineStyleExpression } from "./utils/get-inline-style-expression.js";
import { getStylePropertyStringValue } from "./utils/get-style-property-string-value.js";
import { getStylePropertyKey } from "./utils/get-style-property-key.js";
import { getStylePropertyNumberValue } from "./utils/get-style-property-number-value.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

// Reads a JSX attribute value as a string literal, unwrapping a
// `{'...'}` expression container. Returns null for dynamic/non-string
// values. Covers `textTransform="uppercase"` and `textTransform={'uppercase'}`.
const getJsxAttributeStringValue = (attributeValue: EsTreeNode | null): string | null => {
  if (!attributeValue) return null;
  if (isNodeOfType(attributeValue, "Literal") && typeof attributeValue.value === "string") {
    return attributeValue.value;
  }
  if (isNodeOfType(attributeValue, "JSXExpressionContainer")) {
    const expression = attributeValue.expression;
    if (isNodeOfType(expression, "Literal") && typeof expression.value === "string") {
      return expression.value;
    }
  }
  return null;
};

// A bare boolean prop (`uppercase`) has a null value; `uppercase={true}`
// wraps a `true` literal. Both signal the prop is enabled.
const isTruthyBooleanJsxAttribute = (attributeValue: EsTreeNode | null): boolean => {
  if (attributeValue === null) return true;
  if (isNodeOfType(attributeValue, "JSXExpressionContainer")) {
    const expression = attributeValue.expression;
    return isNodeOfType(expression, "Literal") && expression.value === true;
  }
  return false;
};

// The rule's whole false-positive exemption is "wide tracking is fine on
// uppercase labels". When the uppercase transform comes from inline
// `textTransform`, the loop below sees it. But design-system text
// components routinely expose the transform as a sibling prop —
// `<SSText uppercase style={{ letterSpacing: 2 }}>` (satsigner#671) — or
// a `textTransform="uppercase"` prop. The rule can't see inside the
// component, so it inspects the element's own attributes: if the same
// element already declares the uppercase intent, treat the wide tracking
// as the recommended use and stay quiet.
const hasUppercaseSiblingProp = (styleAttribute: EsTreeNodeOfType<"JSXAttribute">): boolean => {
  const openingElement = styleAttribute.parent;
  if (!openingElement || !isNodeOfType(openingElement, "JSXOpeningElement")) return false;
  for (const attribute of openingElement.attributes ?? []) {
    if (!isNodeOfType(attribute, "JSXAttribute")) continue;
    if (!isNodeOfType(attribute.name, "JSXIdentifier")) continue;
    const attributeName = attribute.name.name;
    if (attributeName === "uppercase" && isTruthyBooleanJsxAttribute(attribute.value)) return true;
    if (
      attributeName === "textTransform" &&
      getJsxAttributeStringValue(attribute.value) === "uppercase"
    ) {
      return true;
    }
  }
  return false;
};

export const noWideLetterSpacing = defineRule<Rule>({
  id: "no-wide-letter-spacing",
  title: "Wide letter spacing on body text",
  severity: "warn",
  tags: ["test-noise"],
  recommendation:
    "Save wide letter-spacing (over 0.05em) for short uppercase labels, nav items, and buttons, not body text.",
  create: (context: RuleContext) => ({
    JSXAttribute(node: EsTreeNodeOfType<"JSXAttribute">) {
      const expression = getInlineStyleExpression(node);
      if (!expression) return;

      if (hasUppercaseSiblingProp(node)) return;

      let isUppercase = false;
      let letterSpacingProperty: EsTreeNode | null = null;
      let letterSpacingEm: number | null = null;

      for (const property of expression.properties ?? []) {
        const key = getStylePropertyKey(property);
        if (!key) continue;

        if (key === "textTransform") {
          const value = getStylePropertyStringValue(property);
          if (value === "uppercase") isUppercase = true;
        }

        if (key === "letterSpacing") {
          letterSpacingProperty = property;
          const strValue = getStylePropertyStringValue(property);
          const numValue = getStylePropertyNumberValue(property);
          if (strValue) {
            const emMatch = strValue.match(/^([\d.]+)em$/);
            if (emMatch) letterSpacingEm = parseFloat(emMatch[1]);
            const pxMatch = strValue.match(/^([\d.]+)px$/);
            if (pxMatch) letterSpacingEm = parseFloat(pxMatch[1]) / 16;
          }
          if (numValue !== null && numValue > 0) {
            letterSpacingEm = numValue / 16;
          }
        }
      }

      if (
        !isUppercase &&
        letterSpacingProperty &&
        letterSpacingEm !== null &&
        letterSpacingEm > WIDE_TRACKING_THRESHOLD_EM
      ) {
        context.report({
          node: letterSpacingProperty,
          message: `Your users find body text harder to read at ${letterSpacingEm.toFixed(2)}em letter spacing, so save wide spacing for short uppercase labels.`,
        });
      }
    },
  }),
});
