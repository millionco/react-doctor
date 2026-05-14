import { defineRule } from "../../utils/define-rule.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

export const rnNoSingleElementStyleArray = defineRule<Rule>({
  requires: ["react-native"],
  framework: "react-native",
  severity: "warn",
  category: "React Native",
  recommendation:
    "Use `style={value}` instead of `style={[value]}` — single-element arrays add unnecessary allocation",
  examples: [
    {
      before: "<View style={[styles.card]} />",
      after: "<View style={styles.card} />",
    },
  ],
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
        message: `Single-element style array on "${propName}" — use ${propName}={value} instead of ${propName}={[value]} to avoid unnecessary array allocation`,
      });
    },
  }),
});
