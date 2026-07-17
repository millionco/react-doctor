import { defineRule } from "../../utils/define-rule.js";
import { getAuthoritativeJsxAttribute } from "../../utils/get-authoritative-jsx-attribute.js";
import { getClassNameTokens } from "../../utils/get-class-name-tokens.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isProvenFramerMotionJsxElement } from "../../utils/is-proven-framer-motion-jsx-element.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { getInlineStyleExpression } from "./utils/get-inline-style-expression.js";
import { getStringFromClassNameAttr } from "./utils/get-string-from-class-name-attr.js";
import { getStylePropertyKey } from "./utils/get-style-property-key.js";
import { getStylePropertyStringValue } from "./utils/get-style-property-string-value.js";

const EASE_IN_TOKEN_PATTERN = /(?:^|[\s,])ease-in(?=$|[\s,])/i;
const TIMING_PROPERTY_NAMES = new Set([
  "transition",
  "transitionTimingFunction",
  "animation",
  "animationTimingFunction",
]);

const getMotionEaseProperty = (node: EsTreeNode): EsTreeNode | null => {
  if (!isNodeOfType(node, "Property") || getStylePropertyKey(node) !== "ease") return null;
  const easeValue = getStylePropertyStringValue(node);
  return easeValue === "easeIn" || easeValue === "ease-in" ? node : null;
};

export const noEaseInMotion = defineRule({
  id: "no-ease-in-motion",
  title: "UI motion starts with ease-in",
  severity: "warn",
  tags: ["design", "test-noise"],
  category: "Performance",
  recommendation:
    "Use ease-out for entrances and exits, or ease-in-out when an element remains visible while moving.",
  create: (context: RuleContext) => ({
    JSXAttribute(node: EsTreeNodeOfType<"JSXAttribute">) {
      const styleExpression = getInlineStyleExpression(node);
      if (styleExpression) {
        for (const property of styleExpression.properties ?? []) {
          const propertyName = getStylePropertyKey(property);
          const propertyValue = getStylePropertyStringValue(property);
          if (
            propertyName &&
            TIMING_PROPERTY_NAMES.has(propertyName) &&
            propertyValue &&
            EASE_IN_TOKEN_PATTERN.test(propertyValue)
          ) {
            context.report({
              node: property,
              message:
                "Ease-in delays the visible response and makes this interaction feel sluggish. Use ease-out or a responsive custom curve.",
            });
          }
        }
      }

      if (
        !isNodeOfType(node.name, "JSXIdentifier") ||
        node.name.name !== "transition" ||
        !isNodeOfType(node.parent, "JSXOpeningElement") ||
        !Object.is(getAuthoritativeJsxAttribute(node.parent.attributes, "transition"), node) ||
        !isProvenFramerMotionJsxElement(node.parent, context.scopes) ||
        !node.value ||
        !isNodeOfType(node.value, "JSXExpressionContainer") ||
        !isNodeOfType(node.value.expression, "ObjectExpression")
      ) {
        return;
      }
      const easeProperty = node.value.expression.properties?.find(getMotionEaseProperty);
      if (easeProperty) {
        context.report({
          node: easeProperty,
          message:
            "Ease-in makes the first part of this UI motion feel unresponsive. Prefer ease-out for state changes users trigger.",
        });
      }
    },
    JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
      const classNameValue = getStringFromClassNameAttr(node);
      if (!classNameValue) return;
      if (!getClassNameTokens(classNameValue).includes("ease-in")) return;
      context.report({
        node,
        message:
          "This ease-in utility back-loads the visible response. Use ease-out or a purpose-built timing curve for UI motion.",
      });
    },
  }),
});
