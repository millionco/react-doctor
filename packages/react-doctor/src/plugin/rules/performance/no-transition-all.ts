import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";

export const noTransitionAll = defineRule<Rule>({
  recommendation:
    'List specific properties: `transition: "opacity 200ms, transform 200ms"` — or in Tailwind use `transition-colors`, `transition-opacity`, or `transition-transform`',
  create: (context: RuleContext) => ({
    JSXAttribute(node: EsTreeNode) {
      if (node.name?.type !== "JSXIdentifier" || node.name.name !== "style") return;
      if (node.value?.type !== "JSXExpressionContainer") return;

      const expression = node.value.expression;
      if (expression?.type !== "ObjectExpression") return;

      for (const property of expression.properties ?? []) {
        if (property.type !== "Property") continue;
        const key = property.key?.type === "Identifier" ? property.key.name : null;
        if (key !== "transition") continue;

        if (
          property.value?.type === "Literal" &&
          typeof property.value.value === "string" &&
          property.value.value.startsWith("all")
        ) {
          context.report({
            node: property,
            message:
              'transition: "all" animates every property including layout — list only the properties you animate',
          });
        }
      }
    },
  }),
});
