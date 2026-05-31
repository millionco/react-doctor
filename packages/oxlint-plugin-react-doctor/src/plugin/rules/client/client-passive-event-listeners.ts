import { PASSIVE_EVENT_NAMES } from "../../constants/dom.js";
import { defineRule } from "../../utils/define-rule.js";
import { isMemberProperty } from "../../utils/is-member-property.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

export const clientPassiveEventListeners = defineRule<Rule>({
  id: "client-passive-event-listeners",
  title: "Non-passive scroll listener",
  tags: ["test-noise"],
  severity: "warn",
  recommendation:
    "Add `{ passive: true }` as the third argument: `addEventListener('scroll', handler, { passive: true })`. Only do this if the handler doesn't call `event.preventDefault()`, since passive listeners ignore it (which breaks pull-to-refresh, custom gestures, and nested scrolling).",
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      if (!isMemberProperty(node.callee, "addEventListener")) return;
      if ((node.arguments?.length ?? 0) < 2) return;

      const eventNameNode = node.arguments[0];
      if (
        !isNodeOfType(eventNameNode, "Literal") ||
        typeof eventNameNode.value !== "string" ||
        !PASSIVE_EVENT_NAMES.has(eventNameNode.value)
      )
        return;

      const eventName = eventNameNode.value;
      const optionsArgument = node.arguments[2];

      if (!optionsArgument) {
        context.report({
          node,
          message: `"${eventName}" listener without { passive: true } makes scrolling janky for your users. Only add it if the handler doesn't call event.preventDefault(), since passive listeners silently ignore preventDefault().`,
        });
        return;
      }

      if (!isNodeOfType(optionsArgument, "ObjectExpression")) return;

      const hasPassiveTrue = optionsArgument.properties?.some(
        (property: EsTreeNode) =>
          isNodeOfType(property, "Property") &&
          isNodeOfType(property.key, "Identifier") &&
          property.key.name === "passive" &&
          isNodeOfType(property.value, "Literal") &&
          property.value.value === true,
      );

      if (!hasPassiveTrue) {
        context.report({
          node,
          message: `"${eventName}" listener without { passive: true } makes scrolling janky for your users. Only add it if the handler doesn't call event.preventDefault(), since passive listeners silently ignore preventDefault().`,
        });
      }
    },
  }),
});
