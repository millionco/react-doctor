import { GENERIC_EVENT_SUFFIXES } from "../../constants/react.js";
import { defineRule } from "../../utils/define-rule.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

export const noGenericHandlerNames = defineRule<Rule>({
  id: "no-generic-handler-names",
  title: "Vague event handler name",
  severity: "warn",
  tags: ["test-noise"],
  recommendation:
    "Rename it to say what it does. For example `handleSubmit` could be `saveUserProfile`, and `handleClick` could be `toggleSidebar`.",
  create: (context: RuleContext) => ({
    JSXAttribute(node: EsTreeNodeOfType<"JSXAttribute">) {
      if (!isNodeOfType(node.name, "JSXIdentifier") || !node.name.name.startsWith("on")) return;
      if (!node.value || !isNodeOfType(node.value, "JSXExpressionContainer")) return;

      const eventSuffix = node.name.name.slice(2);
      if (!GENERIC_EVENT_SUFFIXES.has(eventSuffix)) return;

      const mirroredHandlerName = `handle${eventSuffix}`;
      const expression = node.value.expression;
      if (isNodeOfType(expression, "Identifier") && expression.name === mirroredHandlerName) {
        context.report({
          node,
          message: `The handler name "${expression.name}" says when it runs, not what it does, so name it after the action instead.`,
        });
      }
    },
  }),
});
