import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getElementType } from "../../utils/get-element-type.js";
import { hasJsxPropIgnoreCase } from "../../utils/has-jsx-prop-ignore-case.js";
import { isHiddenFromScreenReader } from "../../utils/is-hidden-from-screen-reader.js";
import { objectHasAccessibleChild } from "../../utils/object-has-accessible-child.js";
import type { Rule } from "../../utils/rule.js";

const MESSAGE =
  "Blind users can't follow this link because screen readers announce nothing, so add visible text, `aria-label`, or `aria-labelledby`.";

// Port of `oxc_linter::rules::jsx_a11y::anchor_has_content`.
export const anchorHasContent = defineRule<Rule>({
  id: "anchor-has-content",
  title: "Anchor has no content",
  tags: ["react-jsx-only"],
  severity: "warn",
  recommendation: "Put readable text inside every `<a>`.",
  category: "Accessibility",
  create: (context) => ({
    JSXElement(node: EsTreeNodeOfType<"JSXElement">) {
      const opening = node.openingElement;
      const tag = getElementType(opening, context.settings);
      if (tag !== "a") return;
      if (isHiddenFromScreenReader(opening, context.settings)) return;
      if (objectHasAccessibleChild(node, context.settings)) return;
      for (const attribute of ["title", "aria-label"]) {
        if (hasJsxPropIgnoreCase(opening.attributes, attribute)) return;
      }
      context.report({ node: opening.name, message: MESSAGE });
    },
  }),
});
