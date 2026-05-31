import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getElementType } from "../../utils/get-element-type.js";
import { getJsxAttributeName } from "../../utils/get-jsx-attribute-name.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { Rule } from "../../utils/rule.js";
import { RESERVED_HTML_TAGS } from "../../constants/html-tags.js";

const buildMessage = (tag: string, attribute: string): string =>
  `Screen reader users get no help from \`${attribute}\` because \`<${tag}>\` doesn't accept it, so remove it from this element.`;

// Port of `oxc_linter::rules::jsx_a11y::aria_unsupported_elements`.
// Reports `aria-*` / `role` on reserved HTML tags (e.g. `<base>`,
// `<head>`, `<meta>`).
export const ariaUnsupportedElements = defineRule<Rule>({
  id: "aria-unsupported-elements",
  title: "ARIA on unsupported element",
  tags: ["react-jsx-only"],
  severity: "error",
  recommendation: "Do not put `role` or `aria-*` on reserved HTML elements.",
  category: "Accessibility",
  create: (context) => ({
    JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
      const tag = getElementType(node, context.settings);
      if (!RESERVED_HTML_TAGS.has(tag)) return;
      for (const attribute of node.attributes) {
        if (!isNodeOfType(attribute, "JSXAttribute")) continue;
        if (!isNodeOfType(attribute.name, "JSXIdentifier")) continue;
        const attrName = getJsxAttributeName(attribute.name);
        if (!attrName) continue;
        if (attrName.startsWith("aria-") || attrName === "role") {
          context.report({ node: attribute, message: buildMessage(tag, attrName) });
        }
      }
    },
  }),
});
