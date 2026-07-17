import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getAuthoritativeJsxAttribute } from "../../utils/get-authoritative-jsx-attribute.js";
import { getStaticDirectJsxElements } from "../../utils/get-static-direct-jsx-elements.js";
import { getStringLiteralAttributeValue } from "../../utils/get-string-literal-attribute-value.js";
import { isProvenMotionReactComponent } from "../../utils/is-proven-motion-react-component.js";
import type { RuleContext } from "../../utils/rule-context.js";

export const motionAnimatePresenceWaitSingleChild = defineRule({
  id: "motion-animate-presence-wait-single-child",
  title: "AnimatePresence wait mode has multiple children",
  severity: "warn",
  category: "Correctness",
  recommendation:
    'Render one direct child at a time in `mode="wait"`, or use `sync` or `popLayout` when several children can be present.',
  create: (context: RuleContext) => ({
    JSXElement(node: EsTreeNodeOfType<"JSXElement">) {
      if (
        !isProvenMotionReactComponent(node.openingElement.name, "AnimatePresence", context.scopes)
      ) {
        return;
      }
      const modeAttribute = getAuthoritativeJsxAttribute(node.openingElement.attributes, "mode");
      if (!modeAttribute || getStringLiteralAttributeValue(modeAttribute) !== "wait") return;
      if (getStaticDirectJsxElements(node).length < 2) return;
      context.report({
        node: modeAttribute,
        message:
          'AnimatePresence `mode="wait"` supports only one child at a time, but this tree has multiple direct children. Use one child or another mode.',
      });
    },
  }),
});
