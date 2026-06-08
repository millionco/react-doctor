import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getElementType } from "../../utils/get-element-type.js";
import { hasJsxPropIgnoreCase } from "../../utils/has-jsx-prop-ignore-case.js";
import { isInteractiveElement } from "../../utils/is-interactive-element.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { parseJsxValue } from "../../utils/parse-jsx-value.js";
import type { Rule } from "../../utils/rule.js";

const MESSAGE =
  "Screen reader users tab to this focusable element but hear nothing because `aria-hidden` skips it, so remove `aria-hidden` or stop it being focusable.";

// Port of `oxc_linter::rules::jsx_a11y::no_aria_hidden_on_focusable`.
// Flags interactive / explicitly-tabbable elements that also set
// `aria-hidden`.
export const noAriaHiddenOnFocusable = defineRule<Rule>({
  id: "no-aria-hidden-on-focusable",
  title: "aria-hidden on focusable element",
  tags: ["react-jsx-only"],
  severity: "warn",
  recommendation:
    "Remove `aria-hidden` from focusable elements, or stop them being focusable, so keyboard users do not land on content screen readers hide.",
  category: "Accessibility",
  create: (context) => ({
    JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
      const ariaHidden = hasJsxPropIgnoreCase(node.attributes, "aria-hidden");
      if (!ariaHidden) return;
      // Only flag aria-hidden=true.
      const value = ariaHidden.value;
      if (value) {
        if (isNodeOfType(value, "Literal") && value.value !== "true") return;
        if (isNodeOfType(value, "JSXExpressionContainer")) {
          const expression = value.expression;
          if (isNodeOfType(expression, "Literal") && !expression.value) return;
        }
      }
      const tag = getElementType(node, context.settings);
      const tabIndex = hasJsxPropIgnoreCase(node.attributes, "tabIndex");
      const tabIndexValue = tabIndex ? parseJsxValue(tabIndex.value ?? null) : null;
      // tabIndex < 0 explicitly removes the element from the focus
      // ring; OXC treats that as "not focusable" and skips the rule
      // even on otherwise-interactive elements.
      if (tabIndexValue !== null && tabIndexValue < 0) return;
      const isExplicitlyFocusable = tabIndexValue !== null && tabIndexValue >= 0;
      const isImplicitlyFocusable = isInteractiveElement(tag, node);
      if (isExplicitlyFocusable || isImplicitlyFocusable) {
        context.report({ node: ariaHidden, message: MESSAGE });
      }
    },
  }),
});
