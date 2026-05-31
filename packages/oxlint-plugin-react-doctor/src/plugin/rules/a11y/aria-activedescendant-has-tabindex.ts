import { HTML_TAGS } from "../../constants/html-tags.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getElementType } from "../../utils/get-element-type.js";
import { hasJsxPropIgnoreCase } from "../../utils/has-jsx-prop-ignore-case.js";
import { isInteractiveElement } from "../../utils/is-interactive-element.js";
import { parseJsxValue } from "../../utils/parse-jsx-value.js";
import type { Rule } from "../../utils/rule.js";

const MESSAGE =
  "Keyboard users can't focus this element with `aria-activedescendant` because it isn't tabbable, so add `tabIndex={0}`.";

// Port of `oxc_linter::rules::jsx_a11y::aria_activedescendant_has_tabindex`.
// Reports HTML elements with `aria-activedescendant` that are NOT
// implicitly tabbable AND lack a non-`<-1` `tabIndex`.
export const ariaActivedescendantHasTabindex = defineRule<Rule>({
  id: "aria-activedescendant-has-tabindex",
  title: "aria-activedescendant missing tabindex",
  tags: ["react-jsx-only"],
  severity: "warn",
  recommendation:
    "Add `tabIndex` so keyboard users can reach elements that use `aria-activedescendant`.",
  category: "Accessibility",
  create: (context) => ({
    JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
      if (!hasJsxPropIgnoreCase(node.attributes, "aria-activedescendant")) return;
      const tag = getElementType(node, context.settings);
      // Custom components / unknown tags pass through.
      if (!HTML_TAGS.has(tag)) return;
      const tabIndex = hasJsxPropIgnoreCase(node.attributes, "tabIndex");
      if (tabIndex) {
        // OXC treats tabIndex < -1 as "still problematic", everything
        // else (including 0, -1, "0", template values) as fine.
        const tabIndexValue = parseJsxValue(tabIndex.value ?? null);
        if (tabIndexValue === null || tabIndexValue >= -1) return;
        context.report({ node: node.name, message: MESSAGE });
        return;
      }
      // No tabIndex — interactive elements are implicitly tabbable.
      if (isInteractiveElement(tag, node)) return;
      context.report({ node: node.name, message: MESSAGE });
    },
  }),
});
