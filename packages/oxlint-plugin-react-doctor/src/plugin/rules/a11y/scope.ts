import { HTML_TAGS } from "../../constants/html-tags.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getElementType } from "../../utils/get-element-type.js";
import { hasJsxProp } from "../../utils/has-jsx-prop.js";
import type { Rule } from "../../utils/rule.js";

const MESSAGE =
  "The `scope` attribute only works on `<th>` cells, so screen readers get no table-header help from it here.";

// Port of `oxc_linter::rules::jsx_a11y::scope`. Flags `scope=` on
// non-`<th>` elements.
export const scope = defineRule<Rule>({
  id: "scope",
  title: "scope attribute on non-th element",
  tags: ["react-jsx-only"],
  severity: "warn",
  recommendation: "Remove `scope` from this element or move it to the related `<th>` cell.",
  category: "Accessibility",
  create: (context) => ({
    JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
      const scopeAttribute = hasJsxProp(node.attributes, "scope");
      if (!scopeAttribute) return;
      const tag = getElementType(node, context.settings);
      // Only flag known HTML elements that aren't <th>. Custom JSX
      // components could resolve to any tag at runtime.
      if (!HTML_TAGS.has(tag)) return;
      if (tag !== "th") {
        context.report({ node: scopeAttribute, message: MESSAGE });
      }
    },
  }),
});
