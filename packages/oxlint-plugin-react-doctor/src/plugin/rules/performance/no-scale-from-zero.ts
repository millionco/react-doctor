import { defineRule } from "../../utils/define-rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isProvenFramerMotionJsxElement } from "../../utils/is-proven-framer-motion-jsx-element.js";
import { getAuthoritativeJsxAttribute } from "../../utils/get-authoritative-jsx-attribute.js";
import { getClassNameTokens } from "../../utils/get-class-name-tokens.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import { getInlineStyleExpression } from "../design/utils/get-inline-style-expression.js";
import { getStringFromClassNameAttr } from "../design/utils/get-string-from-class-name-attr.js";
import { getStylePropertyKey } from "../design/utils/get-style-property-key.js";
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
        let transformProperty: EsTreeNode | null = null;
        let hasTransformTransition = false;
        for (const property of styleExpression.properties ?? []) {
          const propertyName = getStylePropertyKey(property);
          const propertyValue = getStylePropertyStringValue(property);
          if (
            propertyName === "transform" &&
            propertyValue &&
            ZERO_SCALE_PATTERN.test(propertyValue)
          ) {
            transformProperty = property;
          }
          if (
            (propertyName === "transition" || propertyName === "transitionProperty") &&
            propertyValue &&
            TRANSFORM_TRANSITION_PATTERN.test(propertyValue)
          ) {
            hasTransformTransition = true;
          }
        }
        if (transformProperty && hasTransformTransition) {
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

      for (const property of expression.properties ?? []) {
        if (!isNodeOfType(property, "Property")) continue;
        const key = isNodeOfType(property.key, "Identifier") ? property.key.name : null;
        if (key !== "scale") continue;

        if (isNodeOfType(property.value, "Literal") && property.value.value === 0) {
          context.report({
            node: property,
            message:
              "This looks abrupt to your users because scale: 0 pops the element in from a single point, so use scale: 0.95 with opacity: 0 for a smoother entrance",
          });
        }
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
