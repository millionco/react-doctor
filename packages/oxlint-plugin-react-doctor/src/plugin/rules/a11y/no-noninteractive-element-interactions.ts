import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getElementType } from "../../utils/get-element-type.js";
import { getJsxPropStringValue } from "../../utils/get-jsx-prop-string-value.js";
import { hasJsxPropIgnoreCase } from "../../utils/has-jsx-prop-ignore-case.js";
import type { Rule } from "../../utils/rule.js";
import { NON_INTERACTIVE_ELEMENTS } from "../../constants/html-tags.js";
import { INTERACTIVE_ROLES } from "../../constants/aria-roles.js";

const buildMessage = (tag: string): string =>
  `Keyboard & screen reader users can't trigger this \`<${tag}>\` because it isn't interactive, so use a button or link or add an interactive role.`;

// Mouse / pointer / keyboard events that imply interaction.
const INTERACTIVE_HANDLERS: ReadonlyArray<string> = [
  "onClick",
  "onMouseDown",
  "onMouseUp",
  "onKeyDown",
  "onKeyPress",
  "onKeyUp",
];

// Port of `oxc_linter::rules::jsx_a11y::no_noninteractive_element_interactions`.
// Reports interactive event handlers attached to non-interactive HTML
// elements without an interactive role.
export const noNoninteractiveElementInteractions = defineRule<Rule>({
  id: "no-noninteractive-element-interactions",
  title: "Handler on non-interactive element",
  tags: ["react-jsx-only"],
  severity: "warn",
  recommendation: "Put interactions on a button or link, or add an interactive role.",
  category: "Accessibility",
  create: (context) => ({
    JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
      const tag = getElementType(node, context.settings);
      if (!NON_INTERACTIVE_ELEMENTS.has(tag)) return;
      const hasHandler = INTERACTIVE_HANDLERS.some((handler) =>
        hasJsxPropIgnoreCase(node.attributes, handler),
      );
      if (!hasHandler) return;
      const roleAttr = hasJsxPropIgnoreCase(node.attributes, "role");
      if (roleAttr) {
        const role = getJsxPropStringValue(roleAttr);
        if (role && INTERACTIVE_ROLES.has(role)) return;
      }
      context.report({ node: node.name, message: buildMessage(tag) });
    },
  }),
});
