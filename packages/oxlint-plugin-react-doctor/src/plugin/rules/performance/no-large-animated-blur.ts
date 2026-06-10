import {
  BLUR_VALUE_PATTERN,
  LARGE_BLUR_THRESHOLD_PX,
  MOTION_ANIMATE_PROPS,
} from "../../constants/style.js";
import { defineRule } from "../../utils/define-rule.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

export const noLargeAnimatedBlur = defineRule<Rule>({
  id: "no-large-animated-blur",
  title: "Large animated blur",
  tags: ["test-noise"],
  severity: "warn",
  recommendation:
    "Keep the blur under 10px, or blur a smaller element. Big blurs use a lot more GPU memory as the element grows",
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
            message: `Large animated blurs can use significant GPU memory on phones because blur(${blurRadius}px) gets heavier as the blur and element grow. Use a smaller blur or a smaller element.`,
          });
        }
      }
    },
  }),
});
