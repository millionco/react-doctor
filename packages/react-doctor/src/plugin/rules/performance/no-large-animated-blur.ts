import {
  BLUR_VALUE_PATTERN,
  LARGE_BLUR_THRESHOLD_PX,
  MOTION_ANIMATE_PROPS,
} from "../../constants.js";
import { defineRule } from "../../utils/define-rule.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

export const noLargeAnimatedBlur = defineRule<Rule>({
  framework: "global",
  severity: "warn",
  category: "Performance",
  recommendation:
    "Keep blur radius under 10px, or apply blur to a smaller element. Large blurs multiply GPU memory usage with layer size",
  examples: [
    {
      before: "<div style={{ backdropFilter: 'blur(40px)' }} />",
      after: "<div style={{ backdropFilter: 'blur(8px)' }} />",
    },
  ],
  create: (context: RuleContext) => ({
    JSXAttribute(node: EsTreeNodeOfType<"JSXAttribute">) {
      if (!isNodeOfType(node.name, "JSXIdentifier")) return;
      if (node.name.name !== "style" && !MOTION_ANIMATE_PROPS.has(node.name.name)) return;
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

        const match = BLUR_VALUE_PATTERN.exec(property.value.value);
        if (!match) continue;

        const blurRadius = Number.parseFloat(match[1]);
        if (blurRadius > LARGE_BLUR_THRESHOLD_PX) {
          context.report({
            node: property,
            message: `blur(${blurRadius}px) is expensive — cost escalates with radius and layer size, can exceed GPU memory on mobile`,
          });
        }
      }
    },
  }),
});
