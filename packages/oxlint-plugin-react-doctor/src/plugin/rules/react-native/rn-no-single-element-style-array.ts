import { defineRule } from "../../utils/define-rule.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

export const rnNoSingleElementStyleArray = defineRule<Rule>({
  id: "rn-no-single-element-style-array",
  title: "Single-element style array",
  tags: ["test-noise"],
  requires: ["react-native"],
  severity: "warn",
  recommendation:
    "Use `style={value}` instead of `style={[value]}`. A one-item array just adds extra work for nothing.",
  create: (context: RuleContext) => ({
    JSXAttribute(node: EsTreeNodeOfType<"JSXAttribute">) {
      const propName = isNodeOfType(node.name, "JSXIdentifier") ? node.name.name : null;
      if (!propName) return;
      if (propName !== "style" && !propName.endsWith("Style")) return;
      if (!isNodeOfType(node.value, "JSXExpressionContainer")) return;

      const expression = node.value.expression;
      if (!isNodeOfType(expression, "ArrayExpression")) return;
      if (expression.elements?.length !== 1) return;

      context.report({
        node: expression,
        message: `Your users pay for an extra array allocation when "${propName}" wraps a single value for nothing.`,
      });
    },
  }),
});
