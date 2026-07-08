import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getJsxPropStringValue } from "../../utils/get-jsx-prop-string-value.js";
import { hasJsxPropIgnoreCase } from "../../utils/has-jsx-prop-ignore-case.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isTestlikeFilename } from "../../utils/is-testlike-filename.js";
import { parseJsxValue } from "../../utils/parse-jsx-value.js";

const MESSAGE =
  "Keyboard users get jumped out of the normal order by a positive `tabIndex`, so use `0` or `-1`.";

// Port of `oxc_linter::rules::jsx_a11y::tabindex_no_positive`. Reports
// `tabIndex={N}` where N > 0. Test / story / docs-example files are
// skipped: positive tabIndex there is a prop-passthrough sentinel or a
// deliberate demo of tab-order behavior, never shipped UI whose tab
// order could be corrupted.
export const tabindexNoPositive = defineRule({
  id: "tabindex-no-positive",
  title: "Positive tabindex value",
  tags: ["react-jsx-only"],
  severity: "warn",
  recommendation:
    "Use `tabIndex={0}` (focusable in source order) or `tabIndex={-1}` (focus only in code).",
  category: "Accessibility",
  create: (context) => ({
    JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
      if (isTestlikeFilename(context.filename)) return;
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
