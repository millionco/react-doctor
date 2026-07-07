import { BOUNCE_ANIMATION_NAMES } from "../../constants/style.js";
import { defineRule } from "../../utils/define-rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { getInlineStyleExpression } from "./utils/get-inline-style-expression.js";
import { getStylePropertyStringValue } from "./utils/get-style-property-string-value.js";
import { getStylePropertyKey } from "./utils/get-style-property-key.js";
import { getStringFromClassNameAttr } from "./utils/get-string-from-class-name-attr.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";

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

// The staggered-dots typing/loading indicator: sibling dots each carry
// `animate-bounce` plus an `animation-delay` offset (Tailwind arbitrary
// class or inline style). The bounce wave IS the affordance — the doc's
// fix prompt reserves bounce for playful loading idioms and only forbids
// it for "default form, toast, or modal feedback" — so replacing it with
// an ease-out transform would erase the component's purpose
// (docs-validation r2: StreamingMessage / BlockPhase / ThinkingIndicator
// three-dot indicators, flagged consistently across FP and TP reviews).
const hasAnimationDelayStagger = (node: EsTreeNodeOfType<"JSXOpeningElement">): boolean => {
  for (const attribute of node.attributes ?? []) {
    if (!isNodeOfType(attribute, "JSXAttribute")) continue;
    const styleExpression = getInlineStyleExpression(attribute);
    if (!styleExpression) continue;
    for (const property of styleExpression.properties ?? []) {
      if (getStylePropertyKey(property) === "animationDelay") return true;
    }
  }
  return false;
};

export const noInlineBounceEasing = defineRule({
  id: "no-inline-bounce-easing",
  title: "Bouncy easing animation",
  severity: "warn",
  tags: ["test-noise"],
  category: "Performance",
  recommendation:
    "Use `cubic-bezier(0.16, 1, 0.3, 1)` (ease-out-expo) for a natural finish. Real objects don't bounce.",
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
              "This bouncy easing can feel distracting. Use ease-out or cubic-bezier(0.16, 1, 0.3, 1) for a smoother finish.",
          });
        }

        if ((key === "animation" || key === "animationName") && hasBounceAnimationName(value)) {
          context.report({
            node: property,
            message:
              "This bounce animation can feel distracting. Use a smooth ease-out, like ease-out-quart or expo, for a natural finish.",
          });
        }
      }
    },
    JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
      const classStr = getStringFromClassNameAttr(node);
      if (!classStr) return;

      if (/\banimate-bounce\b/.test(classStr)) {
        if (/\[animation-delay:/.test(classStr)) return;
        if (hasAnimationDelayStagger(node)) return;
        context.report({
          node,
          message:
            "Your users see a dated, tacky animate-bounce, so use a subtle ease-out transform for a smoother finish.",
        });
      }
    },
  }),
});
