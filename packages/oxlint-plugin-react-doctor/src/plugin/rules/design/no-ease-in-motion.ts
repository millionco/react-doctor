import { defineRule } from "../../utils/define-rule.js";
import { getClassNameTokens } from "../../utils/get-class-name-tokens.js";
import { getStaticMotionTransitionObjects } from "../../utils/get-static-motion-transition-objects.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { getEffectiveStyleProperty } from "./utils/get-effective-style-property.js";
import { getInlineStyleExpression } from "./utils/get-inline-style-expression.js";
import { getStringFromClassNameAttr } from "./utils/get-string-from-class-name-attr.js";
import { getStylePropertyStringValue } from "./utils/get-style-property-string-value.js";

const EASE_IN_TOKEN_PATTERN = /(?:^|[\s,])ease-in(?=$|[\s,])/i;
const TIMING_PROPERTY_NAMES = new Set([
  "transition",
  "transitionTimingFunction",
  "animation",
  "animationTimingFunction",
]);

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
        for (const propertyName of TIMING_PROPERTY_NAMES) {
          const property = getEffectiveStyleProperty(styleExpression.properties, propertyName);
          if (!property) continue;
          const propertyValue = getStylePropertyStringValue(property);
          if (propertyValue && EASE_IN_TOKEN_PATTERN.test(propertyValue)) {
            context.report({
              node: property,
              message:
                "Ease-in delays the visible response and makes this interaction feel sluggish. Use ease-out or a responsive custom curve.",
            });
          }
        }
      }
    },
    JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
      for (const transitionObject of getStaticMotionTransitionObjects(node, context.scopes)) {
        const easeProperty = getEffectiveStyleProperty(transitionObject.properties, "ease");
        const easeValue = easeProperty ? getStylePropertyStringValue(easeProperty) : null;
        if (easeProperty && (easeValue === "easeIn" || easeValue === "ease-in")) {
          context.report({
            node: easeProperty,
            message:
              "Ease-in makes the first part of this UI motion feel unresponsive. Prefer ease-out for state changes users trigger.",
          });
        }
      }

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
