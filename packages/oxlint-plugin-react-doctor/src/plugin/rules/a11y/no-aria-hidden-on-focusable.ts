import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getElementType } from "../../utils/get-element-type.js";
import { getJsxPropStringValue } from "../../utils/get-jsx-prop-string-value.js";
import { hasJsxPropIgnoreCase } from "../../utils/has-jsx-prop-ignore-case.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { parseJsxValue } from "../../utils/parse-jsx-value.js";

const MESSAGE =
  "Screen reader users tab to this focusable element but hear nothing because `aria-hidden` skips it, so remove `aria-hidden` or stop it being focusable.";

// Tags that are keyboard-focusable by default. Deliberately NARROWER
// than `isInteractiveElement` (which mirrors OXC's ARIA-interactivity
// map): canvas / tr / td / th / option / datalist are "interactive" in
// that map but are never in the tab order, so `aria-hidden` on them is
// the correct decorative-content pattern, not a focus trap.
const ALWAYS_FOCUSABLE_TAGS: ReadonlySet<string> = new Set([
  "button",
  "embed",
  "select",
  "summary",
  "textarea",
]);

const isNativelyFocusable = (
  tagName: string,
  openingElement: EsTreeNodeOfType<"JSXOpeningElement">,
): boolean => {
  if (ALWAYS_FOCUSABLE_TAGS.has(tagName)) return true;
  switch (tagName) {
    case "input": {
      const typeAttribute = hasJsxPropIgnoreCase(openingElement.attributes, "type");
      if (typeAttribute) {
        const typeValue = getJsxPropStringValue(typeAttribute);
        if (typeValue && typeValue.toLowerCase() === "hidden") return false;
      }
      return true;
    }
    case "a":
    case "area":
      return hasJsxPropIgnoreCase(openingElement.attributes, "href") !== undefined;
    case "audio":
    case "video":
      return hasJsxPropIgnoreCase(openingElement.attributes, "controls") !== undefined;
    default:
      return false;
  }
};

const HIDING_STYLE_VALUES: Readonly<Record<string, string>> = {
  display: "none",
  visibility: "hidden",
};

// `style={{ display: 'none' }}` / `{ visibility: 'hidden' }` removes
// the element from the tab order entirely, so nobody can focus it.
const hasStaticHidingInlineStyle = (
  openingElement: EsTreeNodeOfType<"JSXOpeningElement">,
): boolean => {
  const styleAttribute = hasJsxPropIgnoreCase(openingElement.attributes, "style");
  if (!styleAttribute?.value || !isNodeOfType(styleAttribute.value, "JSXExpressionContainer")) {
    return false;
  }
  const expression: EsTreeNode = styleAttribute.value.expression;
  if (!isNodeOfType(expression, "ObjectExpression")) return false;
  for (const property of expression.properties) {
    if (!isNodeOfType(property, "Property")) continue;
    const key = property.key;
    let keyName: string | null = null;
    if (isNodeOfType(key, "Identifier")) keyName = key.name;
    else if (isNodeOfType(key, "Literal") && typeof key.value === "string") keyName = key.value;
    if (!keyName) continue;
    const hidingValue = HIDING_STYLE_VALUES[keyName];
    if (!hidingValue) continue;
    if (isNodeOfType(property.value, "Literal") && property.value.value === hidingValue) {
      return true;
    }
  }
  return false;
};

const isHidingClassToken = (token: string): boolean =>
  token === "hidden" || token.endsWith("-hidden");

// A className containing a `hidden` / `*-hidden` token (Tailwind's
// `hidden`, BEM-ish `adm-text-area-element-hidden`, …) marks the
// element as display/visibility-hidden and thus unfocusable. Template
// literals are checked on their static chunks so `${prefix}-hidden`
// still matches.
const hasHidingClassName = (openingElement: EsTreeNodeOfType<"JSXOpeningElement">): boolean => {
  const classNameAttribute = hasJsxPropIgnoreCase(openingElement.attributes, "className");
  if (!classNameAttribute?.value) return false;
  let classNameText: string | null = null;
  const value = classNameAttribute.value;
  if (isNodeOfType(value, "Literal") && typeof value.value === "string") {
    classNameText = value.value;
  } else if (isNodeOfType(value, "JSXExpressionContainer")) {
    const expression: EsTreeNode = value.expression;
    if (isNodeOfType(expression, "Literal") && typeof expression.value === "string") {
      classNameText = expression.value;
    } else if (isNodeOfType(expression, "TemplateLiteral")) {
      classNameText = expression.quasis.map((quasi) => quasi.value.cooked ?? "").join(" ");
    }
  }
  if (!classNameText) return false;
  return classNameText.split(/\s+/).some(isHidingClassToken);
};

// Port of `oxc_linter::rules::jsx_a11y::no_aria_hidden_on_focusable`.
// Flags natively-focusable / explicitly-tabbable elements that also set
// `aria-hidden`.
export const noAriaHiddenOnFocusable = defineRule({
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
          if (!isNodeOfType(expression, "Literal")) return;
          if (expression.value !== true && expression.value !== "true") return;
        }
      }
      const tag = getElementType(node, context.settings);
      const tabIndex = hasJsxPropIgnoreCase(node.attributes, "tabIndex");
      const tabIndexValue = tabIndex ? parseJsxValue(tabIndex.value ?? null) : null;
      // tabIndex < 0 explicitly removes the element from the focus
      // ring; OXC treats that as "not focusable" and skips the rule
      // even on otherwise-interactive elements.
      if (tabIndexValue !== null && tabIndexValue < 0) return;
      // A statically hidden element (display:none / visibility:hidden /
      // the `hidden` attribute) is out of the tab order no matter what,
      // so nobody can land focus on it — the hidden-input-behind-a-
      // labeled-trigger file-picker pattern.
      if (hasJsxPropIgnoreCase(node.attributes, "hidden")) return;
      if (hasStaticHidingInlineStyle(node)) return;
      if (hasHidingClassName(node)) return;
      const isExplicitlyFocusable = tabIndexValue !== null && tabIndexValue >= 0;
      const isImplicitlyFocusable = isNativelyFocusable(tag, node);
      if (isExplicitlyFocusable || isImplicitlyFocusable) {
        context.report({ node: ariaHidden, message: MESSAGE });
      }
    },
  }),
});
