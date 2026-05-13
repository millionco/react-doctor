import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";

export const noPermanentWillChange = defineRule<Rule>({
  recommendation:
    "Add will-change on animation start (`onMouseEnter`) and remove on end (`onAnimationEnd`). Permanent promotion wastes GPU memory and can degrade performance",
  create: (context: RuleContext) => ({
    JSXAttribute(node: EsTreeNode) {
      if (node.name?.type !== "JSXIdentifier" || node.name.name !== "style") return;
      if (node.value?.type !== "JSXExpressionContainer") return;

      const expression = node.value.expression;
      if (expression?.type !== "ObjectExpression") return;

      for (const property of expression.properties ?? []) {
        if (property.type !== "Property") continue;
        const key = property.key?.type === "Identifier" ? property.key.name : null;
        if (key !== "willChange") continue;

        context.report({
          node: property,
          message:
            "Permanent will-change wastes GPU memory — apply only during active animation and remove after",
        });
      }
    },
  }),
});
