import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getStaticDirectJsxElements } from "../../utils/get-static-direct-jsx-elements.js";
import { hasJsxKeyAttribute } from "../../utils/has-jsx-key-attribute.js";
import { isProvenMotionReactComponent } from "../../utils/is-proven-motion-react-component.js";
import type { RuleContext } from "../../utils/rule-context.js";

export const motionAnimatePresenceRequiresKey = defineRule({
  id: "motion-animate-presence-requires-key",
  title: "AnimatePresence child is missing a key",
  severity: "warn",
  category: "Correctness",
  recommendation:
    "Give every direct AnimatePresence child a stable key derived from its identity so Motion can track which element exits.",
  create: (context: RuleContext) => ({
    JSXElement(node: EsTreeNodeOfType<"JSXElement">) {
      if (
        !isProvenMotionReactComponent(node.openingElement.name, "AnimatePresence", context.scopes)
      ) {
        return;
      }
      const directChildren = getStaticDirectJsxElements(node);
      if (directChildren.length < 2) return;
      for (const child of directChildren) {
        if (hasJsxKeyAttribute(child.openingElement)) continue;
        context.report({
          node: child.openingElement,
          message:
            "This direct AnimatePresence child has no key, so Motion cannot reliably match it with its exiting instance. Add a stable unique key.",
        });
      }
    },
  }),
});
