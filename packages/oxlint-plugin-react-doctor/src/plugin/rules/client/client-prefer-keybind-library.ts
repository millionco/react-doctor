import { KEYBOARD_EVENT_NAMES } from "../../constants/dom.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isMemberProperty } from "../../utils/is-member-property.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";

const GLOBAL_LISTENER_OBJECTS = new Set(["window", "document"]);

const isInsideUseEffectCallback = (node: EsTreeNode): boolean => {
  let current: EsTreeNode | null | undefined = node.parent;
  while (current) {
    if (
      isNodeOfType(current, "CallExpression") &&
      isNodeOfType(current.callee, "Identifier") &&
      (current.callee.name === "useEffect" || current.callee.name === "useLayoutEffect")
    ) {
      return true;
    }
    current = current.parent;
  }
  return false;
};

const buildRecommendationMessage = (eventName: string, receiverName: string | null): string => {
  const receiverPrefix = receiverName ? `${receiverName}.` : "";
  return `${receiverPrefix}addEventListener("${eventName}", …) registers a manual keyboard shortcut — use a keybind library like react-hotkeys-hook instead for consistent, declarative, and accessible keyboard shortcut management`;
};

export const clientPreferKeybindLibrary = defineRule<Rule>({
  id: "client-prefer-keybind-library",
  tags: ["test-noise"],
  severity: "warn",
  category: "Architecture",
  recommendation:
    'Use a keybind library like react-hotkeys-hook (`useHotkeys("mod+k", handler)`) instead of manual addEventListener("keydown", …) — it handles focus scoping, modifier normalization, and cleanup automatically',
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      if (!isMemberProperty(node.callee, "addEventListener")) return;
      if ((node.arguments?.length ?? 0) < 2) return;

      const eventNameNode = node.arguments[0];
      if (
        !isNodeOfType(eventNameNode, "Literal") ||
        typeof eventNameNode.value !== "string" ||
        !KEYBOARD_EVENT_NAMES.has(eventNameNode.value)
      ) {
        return;
      }

      const callee = node.callee;
      if (!isNodeOfType(callee, "MemberExpression")) return;

      const isGlobalReceiver =
        isNodeOfType(callee.object, "Identifier") &&
        GLOBAL_LISTENER_OBJECTS.has(callee.object.name);
      const isEffectBound = isInsideUseEffectCallback(node);

      if (!isGlobalReceiver && !isEffectBound) return;

      const receiverName = isNodeOfType(callee.object, "Identifier") ? callee.object.name : null;

      context.report({
        node,
        message: buildRecommendationMessage(eventNameNode.value, receiverName),
      });
    },
  }),
});
