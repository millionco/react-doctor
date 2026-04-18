import { PASSIVE_EVENT_NAMES } from "../constants.js";
import { isMemberProperty } from "../helpers.js";
import type { EsTreeNode, Rule, RuleContext } from "../types.js";

export const clientPassiveEventListeners: Rule = {
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNode) {
      if (!isMemberProperty(node.callee, "addEventListener")) return;
      if (node.arguments?.length < 2) return;

      const eventNameNode = node.arguments[0];
      if (eventNameNode.type !== "Literal" || !PASSIVE_EVENT_NAMES.has(eventNameNode.value)) return;

      const eventName = eventNameNode.value;
      const optionsArgument = node.arguments[2];

      if (!optionsArgument) {
        context.report({
          node,
          message: `"${eventName}" listener without { passive: true } — blocks scrolling performance`,
        });
        return;
      }

      if (optionsArgument.type !== "ObjectExpression") return;

      const hasPassiveTrue = optionsArgument.properties?.some(
        (property: EsTreeNode) =>
          property.type === "Property" &&
          property.key?.type === "Identifier" &&
          property.key.name === "passive" &&
          property.value?.type === "Literal" &&
          property.value.value === true,
      );

      if (!hasPassiveTrue) {
        context.report({
          node,
          message: `"${eventName}" listener without { passive: true } — blocks scrolling performance`,
        });
      }
    },
  }),
};
