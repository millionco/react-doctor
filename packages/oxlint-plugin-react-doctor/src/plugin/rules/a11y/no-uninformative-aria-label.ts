import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findJsxAttribute } from "../../utils/find-jsx-attribute.js";
import { getStringLiteralAttributeValue } from "../../utils/get-string-literal-attribute-value.js";

// Values that name the *element type* instead of the action/destination.
// A screen-reader user hearing "icon" or "button" learns nothing about
// what the control does. (Kept tight to unambiguous type words to stay
// low-noise — "Menu", "logo", "close" can be legitimate labels.)
const UNINFORMATIVE_LABELS = new Set([
  "icon",
  "button",
  "image",
  "img",
  "graphic",
  "svg",
  "picture",
  "element",
  "field",
  "input",
]);

const MESSAGE =
  'An `aria-label` should name the action or destination, not the element type — this value tells screen-reader users nothing. Use something like `aria-label="Search"` or `aria-label="Close dialog"`.';

export const noUninformativeAriaLabel = defineRule({
  id: "no-uninformative-aria-label",
  title: "Uninformative aria-label",
  severity: "warn",
  recommendation:
    'Name the action, not the element type: `aria-label="Search"`, not `aria-label="icon"` or `aria-label="button"`.',
  create: (context) => ({
    JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
      const ariaLabel = findJsxAttribute(node.attributes, "aria-label");
      if (!ariaLabel) return;
      const labelValue = getStringLiteralAttributeValue(ariaLabel);
      if (labelValue === null) return;
      if (UNINFORMATIVE_LABELS.has(labelValue.trim().toLowerCase())) {
        context.report({ node: ariaLabel, message: MESSAGE });
      }
    },
  }),
});
