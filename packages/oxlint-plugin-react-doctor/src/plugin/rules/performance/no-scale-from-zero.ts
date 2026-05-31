import { defineRule } from "../../utils/define-rule.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

export const noScaleFromZero = defineRule<Rule>({
  id: "no-scale-from-zero",
  title: "Animating scale from zero",
  tags: ["test-noise"],
  severity: "warn",
  recommendation:
    "Use `initial={{ scale: 0.95, opacity: 0 }}`. Elements should gently shrink and fade, not vanish into a point",
  create: (context: RuleContext) => ({
    JSXAttribute(node: EsTreeNodeOfType<"JSXAttribute">) {
      if (!isNodeOfType(node.name, "JSXIdentifier")) return;
      if (node.name.name !== "initial" && node.name.name !== "exit") return;
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
  }),
});
