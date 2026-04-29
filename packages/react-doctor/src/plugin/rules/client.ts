import { PASSIVE_EVENT_NAMES } from "../constants.js";
import { isMemberProperty } from "../helpers.js";
import type { EsTreeNode, Rule, RuleContext } from "../types.js";

const PASSIVE_EVENT_LISTENER_MESSAGE =
  "Listener without { passive: true } — improves scrolling performance, but only use it when the handler does not call event.preventDefault()";

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
          message: `"${eventName}" ${PASSIVE_EVENT_LISTENER_MESSAGE}`,
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
          message: `"${eventName}" ${PASSIVE_EVENT_LISTENER_MESSAGE}`,
        });
      }
    },
  }),
};
