import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getAuthoritativeJsxAttribute } from "../../utils/get-authoritative-jsx-attribute.js";
import { getStringLiteralAttributeValue } from "../../utils/get-string-literal-attribute-value.js";
import { isProvenIntrinsicJsxElement } from "../../utils/is-proven-intrinsic-jsx-element.js";
import type { RuleContext } from "../../utils/rule-context.js";

export const noAssertiveStatus = defineRule({
  id: "no-assertive-status",
  title: "Status live region interrupts assistive technology",
  severity: "warn",
  category: "Accessibility",
  recommendation:
    'Keep `role="status"` polite. Use `role="alert"` only when an interruption is genuinely imperative.',
  create: (context: RuleContext) => ({
    JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
      if (!isProvenIntrinsicJsxElement(node, context.scopes)) return;
      const roleAttribute = getAuthoritativeJsxAttribute(node.attributes, "role", false);
      const liveAttribute = getAuthoritativeJsxAttribute(node.attributes, "aria-live", false);
      if (
        !roleAttribute ||
        !liveAttribute ||
        getStringLiteralAttributeValue(roleAttribute)?.toLowerCase() !== "status" ||
        getStringLiteralAttributeValue(liveAttribute)?.toLowerCase() !== "assertive"
      ) {
        return;
      }
      context.report({
        node: liveAttribute,
        message:
          'A status is advisory and implicitly polite, but `aria-live="assertive"` can interrupt or clear queued speech. Keep the status polite.',
      });
    },
  }),
});
