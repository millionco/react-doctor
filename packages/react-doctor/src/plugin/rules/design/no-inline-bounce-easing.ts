import { BOUNCE_ANIMATION_NAMES } from "../../constants/style.js";
import { defineRule } from "../../utils/define-rule.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { getInlineStyleExpression } from "./utils/get-inline-style-expression.js";
import { getStylePropertyStringValue } from "./utils/get-style-property-string-value.js";
import { getStylePropertyKey } from "./utils/get-style-property-key.js";
import { getStringFromClassNameAttr } from "./utils/get-string-from-class-name-attr.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

const isOvershootCubicBezier = (value: string): boolean => {
  const match = value.match(
    /cubic-bezier\(\s*([\d.-]+)\s*,\s*([\d.-]+)\s*,\s*([\d.-]+)\s*,\s*([\d.-]+)\s*\)/,
  );
  if (!match) return false;
  const controlY1 = parseFloat(match[2]);
  const controlY2 = parseFloat(match[4]);
  return controlY1 < -0.1 || controlY1 > 1.1 || controlY2 < -0.1 || controlY2 > 1.1;
};

const hasBounceAnimationName = (value: string): boolean => {
  const lowerValue = value.toLowerCase();
  for (const name of BOUNCE_ANIMATION_NAMES) {
    if (lowerValue.includes(name)) return true;
  }
  return false;
};

export const noInlineBounceEasing = defineRule<Rule>({
  id: "no-inline-bounce-easing",
  severity: "warn",
  category: "Performance",
  recommendation:
    "Use `cubic-bezier(0.16, 1, 0.3, 1)` (ease-out-expo) for natural deceleration — objects in the real world don't bounce",
  create: (context: RuleContext) => ({
    JSXAttribute(node: EsTreeNodeOfType<"JSXAttribute">) {
      const expression = getInlineStyleExpression(node);
      if (!expression) return;

      for (const property of expression.properties ?? []) {
        const key = getStylePropertyKey(property);
        if (!key) continue;

        const value = getStylePropertyStringValue(property);
        if (!value) continue;

        if (
          (key === "transition" ||
            key === "transitionTimingFunction" ||
            key === "animation" ||
            key === "animationTimingFunction") &&
          isOvershootCubicBezier(value)
        ) {
          context.report({
            node: property,
            message:
              "Bounce/elastic easing feels dated — real objects decelerate smoothly. Use ease-out or cubic-bezier(0.16, 1, 0.3, 1) instead",
          });
        }

        if ((key === "animation" || key === "animationName") && hasBounceAnimationName(value)) {
          context.report({
            node: property,
            message:
              "Bounce/elastic animation name detected — these feel tacky. Use exponential easing (ease-out-quart/expo) for natural deceleration",
          });
        }
      }
    },
    JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
      const classStr = getStringFromClassNameAttr(node);
      if (!classStr) return;

      if (/\banimate-bounce\b/.test(classStr)) {
        context.report({
          node,
          message:
            "animate-bounce feels dated and tacky — use a subtle ease-out transform for natural deceleration",
        });
      }
    },
  }),
});
