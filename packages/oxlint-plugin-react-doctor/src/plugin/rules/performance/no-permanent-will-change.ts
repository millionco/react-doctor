import { defineRule } from "../../utils/define-rule.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

export const noPermanentWillChange = defineRule<Rule>({
  id: "no-permanent-will-change",
  title: "Permanent will-change wastes GPU",
  tags: ["test-noise"],
  severity: "warn",
  recommendation:
    "Add will-change when the animation starts (`onMouseEnter`) and remove it when it ends (`onAnimationEnd`). Leaving it on all the time wastes GPU memory and can slow things down",
  create: (context: RuleContext) => ({
    JSXAttribute(node: EsTreeNodeOfType<"JSXAttribute">) {
      if (!isNodeOfType(node.name, "JSXIdentifier") || node.name.name !== "style") return;
      if (!isNodeOfType(node.value, "JSXExpressionContainer")) return;

      const expression = node.value.expression;
      if (!isNodeOfType(expression, "ObjectExpression")) return;

      for (const property of expression.properties ?? []) {
        if (!isNodeOfType(property, "Property")) continue;
        const key = isNodeOfType(property.key, "Identifier") ? property.key.name : null;
        if (key !== "willChange") continue;

        context.report({
          node: property,
          message:
            "This wastes GPU memory because will-change is left on all the time, so add it right before the animation & remove it when the animation ends",
        });
      }
    },
  }),
});
