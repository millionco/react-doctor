import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getJsxAttributeName } from "../../utils/get-jsx-attribute-name.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { Rule } from "../../utils/rule.js";
import { isValidAriaProperty } from "../../constants/aria-properties.js";

const buildMessage = (name: string): string =>
  `Screen reader users get no help from \`${name}\` because it isn't a real ARIA attribute, so fix the spelling against the WAI-ARIA list.`;

// Port of `oxc_linter::rules::jsx_a11y::aria_props`. Reports any
// attribute name starting with `aria-` that isn't a recognized WAI-ARIA
// property.
export const ariaProps = defineRule<Rule>({
  id: "aria-props",
  title: "Invalid ARIA attribute",
  tags: ["react-jsx-only"],
  severity: "error",
  recommendation: "Only use `aria-*` attributes that actually exist.",
  category: "Accessibility",
  create: (context) => ({
    JSXAttribute(node: EsTreeNodeOfType<"JSXAttribute">) {
      if (!isNodeOfType(node.name, "JSXIdentifier")) return;
      const name = getJsxAttributeName(node.name);
      if (!name || !name.startsWith("aria-")) return;
      if (!isValidAriaProperty(name)) {
        context.report({ node: node.name, message: buildMessage(name) });
      }
    },
  }),
});
