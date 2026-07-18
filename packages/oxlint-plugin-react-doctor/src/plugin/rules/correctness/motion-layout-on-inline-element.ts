import { TAILWIND_DISPLAY_TOKENS } from "../../constants/design.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getAuthoritativeJsxAttribute } from "../../utils/get-authoritative-jsx-attribute.js";
import { getStringLiteralAttributeValue } from "../../utils/get-string-literal-attribute-value.js";
import { getUnvariantClassNameTokens } from "../../utils/get-unvariant-class-name-tokens.js";
import { hasJsxSpreadAttribute } from "../../utils/has-jsx-spread-attribute.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isProvenFramerMotionJsxElement } from "../../utils/is-proven-framer-motion-jsx-element.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { getEffectiveStyleProperty } from "../design/utils/get-effective-style-property.js";
import { getInlineStyleExpression } from "../design/utils/get-inline-style-expression.js";
import { getStringFromClassNameAttr } from "../design/utils/get-string-from-class-name-attr.js";
import { getStylePropertyKey } from "../design/utils/get-style-property-key.js";
import { getStylePropertyStringValue } from "../design/utils/get-style-property-string-value.js";

const ENABLED_LAYOUT_VALUES: ReadonlySet<string> = new Set(["position", "preserve-aspect", "size"]);

const isStaticallyEnabledLayoutAttribute = (
  attribute: EsTreeNodeOfType<"JSXAttribute"> | null,
): boolean => {
  if (!attribute) return false;
  if (!attribute.value) return true;
  const stringValue = getStringLiteralAttributeValue(attribute);
  if (stringValue !== null) return ENABLED_LAYOUT_VALUES.has(stringValue);
  if (!isNodeOfType(attribute.value, "JSXExpressionContainer")) return false;
  const expression = attribute.value.expression;
  return isNodeOfType(expression, "Literal") && expression.value === true;
};

export const motionLayoutOnInlineElement = defineRule({
  id: "motion-layout-on-inline-element",
  title: "Motion layout animation targets an inline element",
  severity: "warn",
  category: "Correctness",
  recommendation:
    "Use inline-block, block, flex, or grid so the browser can apply Motion's transform-based layout animation.",
  create: (context: RuleContext) => ({
    JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
      if (
        !isProvenFramerMotionJsxElement(node, context.scopes) ||
        hasJsxSpreadAttribute(node.attributes)
      ) {
        return;
      }

      const layoutAttribute = getAuthoritativeJsxAttribute(node.attributes, "layout");
      const layoutIdAttribute = getAuthoritativeJsxAttribute(node.attributes, "layoutId");
      if (!layoutIdAttribute && !isStaticallyEnabledLayoutAttribute(layoutAttribute)) return;

      const styleAttribute = getAuthoritativeJsxAttribute(node.attributes, "style");
      if (styleAttribute) {
        const styleExpression = getInlineStyleExpression(styleAttribute);
        if (
          !styleExpression ||
          styleExpression.properties.some((property) => getStylePropertyKey(property) === null)
        ) {
          return;
        }
        const displayProperty = getEffectiveStyleProperty(styleExpression.properties, "display");
        if (displayProperty) {
          if (getStylePropertyStringValue(displayProperty) !== "inline") return;
          context.report({
            node: displayProperty,
            message:
              "Motion cannot apply its transform-based layout animation while this element is display: inline. Use inline-block, block, flex, or grid.",
          });
          return;
        }
      }

      const classNameAttributeCount = node.attributes.filter(
        (attribute) =>
          isNodeOfType(attribute, "JSXAttribute") &&
          isNodeOfType(attribute.name, "JSXIdentifier") &&
          attribute.name.name === "className",
      ).length;
      if (classNameAttributeCount > 1) return;
      const classNameAttribute = getAuthoritativeJsxAttribute(node.attributes, "className");
      const classNameValue = classNameAttribute ? getStringFromClassNameAttr(node) : null;
      if (classNameAttribute && classNameValue === null) return;

      const unvariantClassNameTokens = getUnvariantClassNameTokens(classNameValue ?? "");
      const displayClassNameTokens = unvariantClassNameTokens.filter((token) =>
        TAILWIND_DISPLAY_TOKENS.has(token),
      );
      if (
        !displayClassNameTokens.includes("inline") ||
        displayClassNameTokens.some((token) => token !== "inline")
      ) {
        return;
      }
      context.report({
        node: classNameAttribute ?? node,
        message:
          "Motion cannot apply its transform-based layout animation while this element is display: inline. Use inline-block, block, flex, or grid.",
      });
    },
  }),
});
