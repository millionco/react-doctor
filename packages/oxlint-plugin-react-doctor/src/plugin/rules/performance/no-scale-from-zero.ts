import { defineRule } from "../../utils/define-rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isProvenFramerMotionJsxElement } from "../../utils/is-proven-framer-motion-jsx-element.js";
import { getAuthoritativeJsxAttribute } from "../../utils/get-authoritative-jsx-attribute.js";
import { getClassNameTokens } from "../../utils/get-class-name-tokens.js";
import { getEffectiveStyleProperty } from "../design/utils/get-effective-style-property.js";
import { getInlineStyleExpression } from "../design/utils/get-inline-style-expression.js";
import { getStringFromClassNameAttr } from "../design/utils/get-string-from-class-name-attr.js";
import { getStylePropertyStringValue } from "../design/utils/get-style-property-string-value.js";

const ZERO_SCALE_PATTERN = /\bscale\(\s*0(?:\.0+)?\s*\)/i;
const TRANSFORM_TRANSITION_PATTERN = /(?:^|[\s,])(all|transform)(?=$|[\s,])/i;

export const noScaleFromZero = defineRule({
  id: "no-scale-from-zero",
  title: "Animating scale from zero",
  tags: ["test-noise"],
  severity: "warn",
  recommendation:
    "Use `initial={{ scale: 0.95, opacity: 0 }}`. Elements should gently shrink and fade, not vanish into a point",
  create: (context: RuleContext) => ({
    JSXAttribute(node: EsTreeNodeOfType<"JSXAttribute">) {
      const styleExpression = getInlineStyleExpression(node);
      if (styleExpression) {
        const transformProperty = getEffectiveStyleProperty(
          styleExpression.properties,
          "transform",
        );
        const transformValue = transformProperty
          ? getStylePropertyStringValue(transformProperty)
          : null;
        const hasTransformTransition = ["transition", "transitionProperty"].some((propertyName) => {
          const property = getEffectiveStyleProperty(styleExpression.properties, propertyName);
          const propertyValue = property ? getStylePropertyStringValue(property) : null;
          return propertyValue !== null && TRANSFORM_TRANSITION_PATTERN.test(propertyValue);
        });
        if (
          transformProperty &&
          transformValue &&
          ZERO_SCALE_PATTERN.test(transformValue) &&
          hasTransformTransition
        ) {
          context.report({
            node: transformProperty,
            message:
              "This transition collapses the element to nothing. Keep a small visible scale and use opacity for the rest of the entrance or exit.",
          });
        }
      }

      if (!isNodeOfType(node.name, "JSXIdentifier")) return;
      if (node.name.name !== "initial" && node.name.name !== "exit") return;
      const openingElement = node.parent;
      if (
        !openingElement ||
        !isNodeOfType(openingElement, "JSXOpeningElement") ||
        !Object.is(getAuthoritativeJsxAttribute(openingElement.attributes, node.name.name), node) ||
        !isProvenFramerMotionJsxElement(openingElement, context.scopes)
      ) {
        return;
      }
      if (!isNodeOfType(node.value, "JSXExpressionContainer")) return;

      const expression = node.value.expression;
      if (!isNodeOfType(expression, "ObjectExpression")) return;

      const property = getEffectiveStyleProperty(expression.properties, "scale");
      if (property && isNodeOfType(property.value, "Literal") && property.value.value === 0) {
        context.report({
          node: property,
          message:
            "This looks abrupt to your users because scale: 0 pops the element in from a single point, so use scale: 0.95 with opacity: 0 for a smoother entrance",
        });
      }
    },
    JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
      const classNameValue = getStringFromClassNameAttr(node);
      if (!classNameValue) return;
      const classNameTokens = new Set(getClassNameTokens(classNameValue));
      if (!classNameTokens.has("scale-0")) return;
      if (
        !classNameTokens.has("transition") &&
        !classNameTokens.has("transition-all") &&
        !classNameTokens.has("transition-transform")
      ) {
        return;
      }
      context.report({
        node,
        message:
          "This scale transition makes the element disappear completely. Use a small nonzero scale with opacity instead.",
      });
    },
  }),
});
