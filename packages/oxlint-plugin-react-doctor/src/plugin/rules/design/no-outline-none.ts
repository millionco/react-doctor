import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import { findJsxAttribute } from "../../utils/find-jsx-attribute.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { parseJsxValue } from "../../utils/parse-jsx-value.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { getInlineStyleExpression } from "./utils/get-inline-style-expression.js";
import { getStringFromClassNameAttr } from "./utils/get-string-from-class-name-attr.js";
import { getStylePropertyStringValue } from "./utils/get-style-property-string-value.js";
import { getStylePropertyKey } from "./utils/get-style-property-key.js";
import { getStylePropertyNumberValue } from "./utils/get-style-property-number-value.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

// A focus-variant ring/outline/shadow utility (`focus-visible:ring-2`,
// `focus:shadow-outline`) IS the replacement focus indicator, so
// `outline: none` alongside one is intentional, not an accessibility bug.
const FOCUS_RING_CLASS_PATTERN = /\b(?:focus|focus-visible)[:-][^"'\s]*\b(?:ring|outline|shadow)/;

// An element with a negative `tabIndex` is removed from the tab order,
// so keyboard users never focus it — dropping its focus ring is fine.
const isNotKeyboardFocusable = (styleAttribute: EsTreeNode): boolean => {
  const openingElement = styleAttribute.parent;
  if (!openingElement || !isNodeOfType(openingElement, "JSXOpeningElement")) return false;
  const tabIndexAttribute = findJsxAttribute(openingElement.attributes, "tabIndex");
  if (!tabIndexAttribute) return false;
  const tabIndexValue = parseJsxValue(tabIndexAttribute.value);
  return tabIndexValue !== null && tabIndexValue < 0;
};

export const noOutlineNone = defineRule({
  id: "no-outline-none",
  title: "outline:none removes focus ring",
  severity: "warn",
  tags: ["test-noise"],
  category: "Accessibility",
  recommendation:
    "Style `:focus-visible { outline: 2px solid var(--color-accent); outline-offset: 2px }` so the focus ring shows for keyboard users but not mouse clicks.",
  create: (context: RuleContext) => ({
    JSXAttribute(node: EsTreeNodeOfType<"JSXAttribute">) {
      const expression = getInlineStyleExpression(node);
      if (!expression) return;

      if (isNotKeyboardFocusable(node)) return;

      let hasOutlineNone = false;
      let outlineProperty: EsTreeNode | null = null;

      for (const property of expression.properties ?? []) {
        const key = getStylePropertyKey(property);
        if (key !== "outline") continue;

        const strValue = getStylePropertyStringValue(property);
        const numValue = getStylePropertyNumberValue(property);

        if (strValue === "none" || strValue === "0" || numValue === 0) {
          hasOutlineNone = true;
          outlineProperty = property;
        }
      }

      if (!hasOutlineNone || !outlineProperty) return;

      const hasInlineBoxShadowRing = expression.properties?.some((property: EsTreeNode) => {
        const key = getStylePropertyKey(property);
        return key === "boxShadow";
      });
      const className = node.parent ? getStringFromClassNameAttr(node.parent) : null;
      const hasClassNameFocusRing = Boolean(className && FOCUS_RING_CLASS_PATTERN.test(className));
      const hasCustomFocusRing = hasInlineBoxShadowRing || hasClassNameFocusRing;

      if (!hasCustomFocusRing) {
        context.report({
          node: outlineProperty,
          message:
            "Your keyboard users can't tell where they are because outline: none hides the focus ring, so style :focus-visible instead, or add a box-shadow focus ring.",
        });
      }
    },
  }),
});
