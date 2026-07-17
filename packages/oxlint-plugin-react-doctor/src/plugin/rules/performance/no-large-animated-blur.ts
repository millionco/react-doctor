import {
  BLUR_VALUE_PATTERN,
  LARGE_BLUR_THRESHOLD_PX,
  MOTION_ANIMATE_PROPS,
} from "../../constants/style.js";
import { defineRule } from "../../utils/define-rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getStaticPropertyKeyName } from "../../utils/get-static-property-key-name.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { getStaticWebAnimationKeyframes } from "../../utils/get-static-web-animation-keyframes.js";
import { isProvenBrowserApiReceiver } from "../../utils/is-proven-browser-api-receiver.js";

const getBlurRadius = (value: unknown): number | null => {
  if (typeof value !== "string") return null;
  const match = BLUR_VALUE_PATTERN.exec(value);
  return match ? Number.parseFloat(match[1]) : null;
};

export const noLargeAnimatedBlur = defineRule({
  id: "no-large-animated-blur",
  title: "Large animated blur",
  tags: ["test-noise"],
  severity: "warn",
  recommendation:
    "Keep the blur under 10px, or blur a smaller element. Big blurs use a lot more GPU memory as the element grows",
  create: (context: RuleContext) => ({
    JSXAttribute(node: EsTreeNodeOfType<"JSXAttribute">) {
      if (!isNodeOfType(node.name, "JSXIdentifier")) return;
      if (!MOTION_ANIMATE_PROPS.has(node.name.name)) return;
      if (!isNodeOfType(node.value, "JSXExpressionContainer")) return;

      const expression = node.value.expression;
      if (!isNodeOfType(expression, "ObjectExpression")) return;

      for (const property of expression.properties ?? []) {
        if (!isNodeOfType(property, "Property")) continue;
        const key = isNodeOfType(property.key, "Identifier") ? property.key.name : null;
        if (key !== "filter" && key !== "backdropFilter" && key !== "WebkitBackdropFilter")
          continue;
        if (!isNodeOfType(property.value, "Literal") || typeof property.value.value !== "string")
          continue;

        const blurRadius = getBlurRadius(property.value.value);
        if (blurRadius === null) continue;
        if (blurRadius > LARGE_BLUR_THRESHOLD_PX) {
          context.report({
            node: property,
            message: `Large animated blurs can use significant GPU memory on phones because blur(${blurRadius}px) gets heavier as the blur and element grow. Use a smaller blur or a smaller element.`,
          });
        }
      }
    },
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      if (!isNodeOfType(node.callee, "MemberExpression")) return;
      if (getStaticPropertyName(node.callee) !== "animate") return;
      if (!isProvenBrowserApiReceiver(node.callee.object, "dom-event-target", context.scopes)) {
        return;
      }
      const keyframesArgument = node.arguments?.[0];
      if (!keyframesArgument) return;
      for (const keyframe of getStaticWebAnimationKeyframes(keyframesArgument)) {
        if (!isNodeOfType(keyframe, "ObjectExpression")) continue;
        for (const property of keyframe.properties) {
          if (!isNodeOfType(property, "Property")) continue;
          const propertyName = getStaticPropertyKeyName(property, { allowComputedString: true });
          if (
            propertyName !== "filter" &&
            propertyName !== "backdropFilter" &&
            propertyName !== "backdrop-filter" &&
            propertyName !== "WebkitBackdropFilter" &&
            propertyName !== "-webkit-backdrop-filter"
          ) {
            continue;
          }
          if (!isNodeOfType(property.value, "Literal")) continue;
          const blurRadius = getBlurRadius(property.value.value);
          if (blurRadius === null || blurRadius <= LARGE_BLUR_THRESHOLD_PX) continue;
          context.report({
            node: property,
            message: `This Web Animation uses blur(${blurRadius}px), which can consume significant GPU memory. Use a smaller blur or animate opacity and transform instead.`,
          });
        }
      }
    },
  }),
});
