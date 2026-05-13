import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";

export const rnNoSingleElementStyleArray = defineRule<Rule>({
  recommendation:
    "Use `style={value}` instead of `style={[value]}` — single-element arrays add unnecessary allocation",
  create: (context: RuleContext) => ({
    JSXAttribute(node: EsTreeNode) {
      const propName = node.name?.type === "JSXIdentifier" ? node.name.name : null;
      if (!propName) return;
      if (propName !== "style" && !propName.endsWith("Style")) return;
      if (node.value?.type !== "JSXExpressionContainer") return;

      const expression = node.value.expression;
      if (expression?.type !== "ArrayExpression") return;
      if (expression.elements?.length !== 1) return;

      context.report({
        node: expression,
        message: `Single-element style array on "${propName}" — use ${propName}={value} instead of ${propName}={[value]} to avoid unnecessary array allocation`,
      });
    },
  }),
});
