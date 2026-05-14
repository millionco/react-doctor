import { GENERIC_EVENT_SUFFIXES } from "../../constants.js";
import { defineRule } from "../../utils/define-rule.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

export const noGenericHandlerNames = defineRule<Rule>({
  framework: "global",
  severity: "warn",
  category: "Architecture",
  recommendation:
    "Rename to describe the action: e.g. `handleSubmit` → `saveUserProfile`, `handleClick` → `toggleSidebar`",
  examples: [
    {
      before:
        "const handleClick = () => setOpen(true);\nreturn <button onClick={handleClick}>Open</button>;",
      after:
        "const openSidebar = () => setOpen(true);\nreturn <button onClick={openSidebar}>Open</button>;",
    },
  ],
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
          message: `Non-descriptive handler name "${expression.name}" — name should describe what it does, not when it runs`,
        });
      }
    },
  }),
});
