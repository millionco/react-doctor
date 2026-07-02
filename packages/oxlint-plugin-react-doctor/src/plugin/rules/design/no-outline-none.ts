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

// Only utilities that ADD visible focus styling count as a replacement
// focus indicator. The REMOVAL utilities (`outline-none`, `outline-0`,
// `outline-hidden`, `ring-0`, `ring-transparent`, `shadow-none`) and the
// ring positioning knob `ring-offset-*` strip or offset styling rather
// than draw a ring — treating them as a replacement would hide a
// genuinely invisible keyboard focus.
const isFocusStyleAddingUtility = (utility: string): boolean => {
  if (utility === "ring" || utility === "outline" || utility === "shadow") return true;
  if (utility.startsWith("ring-offset")) return false;
  if (utility === "ring-0" || utility === "ring-transparent") return false;
  if (utility.startsWith("ring-")) return true;
  if (utility === "outline-none" || utility === "outline-0" || utility === "outline-hidden")
    return false;
  if (utility.startsWith("outline-")) return true;
  if (utility === "shadow-none") return false;
  return utility.startsWith("shadow-");
};

// The ring must be keyed to the ELEMENT'S OWN focus (`focus:` /
// `focus-visible:`) — `group-focus:` / `peer-focus:` / `focus-within:`
// style on an ancestor's or sibling's focus, so this element's keyboard
// focus stays invisible.
const hasOwnFocusRingClass = (className: string): boolean =>
  className.split(/\s+/).some((token) => {
    const segments = token.split(":");
    if (segments.length < 2) return false;
    const variants = segments.slice(0, -1);
    if (!variants.some((variant) => variant === "focus" || variant === "focus-visible"))
      return false;
    const rawUtility = segments[segments.length - 1];
    const utility = rawUtility.startsWith("!") ? rawUtility.slice(1) : rawUtility;
    return isFocusStyleAddingUtility(utility);
  });

const parseNumericExpression = (expression: EsTreeNode): number | null => {
  if (isNodeOfType(expression, "Literal")) {
    if (typeof expression.value === "number") return expression.value;
    if (typeof expression.value === "string") {
      const parsed = Number(expression.value);
      return Number.isFinite(parsed) ? parsed : null;
    }
  }
  if (isNodeOfType(expression, "UnaryExpression") && expression.operator === "-") {
    const argumentValue = parseNumericExpression(expression.argument);
    return argumentValue === null ? null : -argumentValue;
  }
  return null;
};

// An element with a negative `tabIndex` is removed from the tab order,
// so keyboard users never focus it — dropping its focus ring is fine. A
// conditional `tabIndex` with a non-static test only qualifies when BOTH
// branches are negative, since either branch can render.
const isNotKeyboardFocusable = (styleAttribute: EsTreeNode): boolean => {
  const openingElement = styleAttribute.parent;
  if (!openingElement || !isNodeOfType(openingElement, "JSXOpeningElement")) return false;
  const tabIndexAttribute = findJsxAttribute(openingElement.attributes, "tabIndex");
  if (!tabIndexAttribute) return false;
  const attributeValue = tabIndexAttribute.value;
  if (attributeValue && isNodeOfType(attributeValue, "JSXExpressionContainer")) {
    const expression = attributeValue.expression;
    if (
      isNodeOfType(expression, "ConditionalExpression") &&
      !isNodeOfType(expression.test, "Literal")
    ) {
      const consequentValue = parseNumericExpression(expression.consequent);
      const alternateValue = parseNumericExpression(expression.alternate);
      return (
        consequentValue !== null &&
        consequentValue < 0 &&
        alternateValue !== null &&
        alternateValue < 0
      );
    }
  }
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
      const hasClassNameFocusRing = Boolean(className && hasOwnFocusRingClass(className));
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
