import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getJsxPropStringValue } from "../../utils/get-jsx-prop-string-value.js";
import { hasJsxPropIgnoreCase } from "../../utils/has-jsx-prop-ignore-case.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { parseJsxValue } from "../../utils/parse-jsx-value.js";
import type { Rule } from "../../utils/rule.js";

const MESSAGE =
  "Keyboard users get jumped out of the normal order by a positive `tabIndex`, so use `0` or `-1`.";

// Port of `oxc_linter::rules::jsx_a11y::tabindex_no_positive`. Reports
// `tabIndex={N}` where N > 0.
export const tabindexNoPositive = defineRule<Rule>({
  id: "tabindex-no-positive",
  title: "Positive tabindex value",
  tags: ["react-jsx-only"],
  severity: "warn",
  recommendation:
    "Use `tabIndex={0}` (focusable in source order) or `tabIndex={-1}` (focus only in code).",
  category: "Accessibility",
  create: (context) => ({
    JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
      const tabIndex = hasJsxPropIgnoreCase(node.attributes, "tabIndex");
      if (!tabIndex) return;
      const stringValue = getJsxPropStringValue(tabIndex);
      let numericValue: number | null = null;
      if (stringValue !== null) {
        const parsed = Number(stringValue);
        if (Number.isFinite(parsed)) numericValue = parsed;
      } else if (tabIndex.value && isNodeOfType(tabIndex.value, "JSXExpressionContainer")) {
        numericValue = parseJsxValue(tabIndex.value);
      }
      if (numericValue !== null && numericValue > 0) {
        context.report({ node: tabIndex, message: MESSAGE });
      }
    },
  }),
});
