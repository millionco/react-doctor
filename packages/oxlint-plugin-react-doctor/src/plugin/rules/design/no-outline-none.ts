import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import { findJsxAttribute } from "../../utils/find-jsx-attribute.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { parseJsxValue } from "../../utils/parse-jsx-value.js";
import { walkAst } from "../../utils/walk-ast.js";
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

const hasJsxAttributeNamed = (openingElement: EsTreeNode, attributeName: string): boolean =>
  Boolean(
    isNodeOfType(openingElement, "JSXOpeningElement") &&
    findJsxAttribute(openingElement.attributes, attributeName),
  );

// A dialog/drawer surface (`aria-modal`) or an element whose own
// focus/blur handlers toggle a custom indicator manages focus visuals
// deliberately — the doc's managed-focus and replacement-ring carve-outs.
const isManagedFocusSurface = (styleAttribute: EsTreeNode): boolean => {
  const openingElement = styleAttribute.parent;
  if (!openingElement || !isNodeOfType(openingElement, "JSXOpeningElement")) return false;
  if (hasJsxAttributeNamed(openingElement, "aria-modal")) return true;
  if (
    hasJsxAttributeNamed(openingElement, "onFocus") &&
    hasJsxAttributeNamed(openingElement, "onBlur")
  ) {
    return true;
  }
  return false;
};

// `<SkipNavContent style={{ outline: 0 }}>` — skip-navigation targets
// (chakra / reach-ui) are programmatically focused with tabIndex=-1 set
// inside the component, so suppressing their outline is the established
// accessible pattern.
const SKIP_NAV_COMPONENT_NAME_PATTERN = /skipnav/i;

const isSkipNavComponent = (styleAttribute: EsTreeNode): boolean => {
  const openingElement = styleAttribute.parent;
  return Boolean(
    openingElement &&
    isNodeOfType(openingElement, "JSXOpeningElement") &&
    isNodeOfType(openingElement.name, "JSXIdentifier") &&
    SKIP_NAV_COMPONENT_NAME_PATTERN.test(openingElement.name.name),
  );
};

// A component that also renders a `*FocusManager*` (floating-ui / Floater)
// is trapping focus programmatically; the surface it styles with
// `outline: none` is a managed container, not a Tab-reachable control.
const getJsxNameText = (name: EsTreeNode | null | undefined): string | null => {
  if (!name) return null;
  if (isNodeOfType(name, "JSXIdentifier")) return name.name;
  if (isNodeOfType(name, "JSXMemberExpression")) {
    return isNodeOfType(name.property, "JSXIdentifier") ? name.property.name : null;
  }
  return null;
};

const rendersFocusManagerInSameFunction = (styleAttribute: EsTreeNode): boolean => {
  let scopeOwner: EsTreeNode = styleAttribute;
  let ancestor: EsTreeNode | null | undefined = styleAttribute.parent;
  while (ancestor) {
    scopeOwner = ancestor;
    if (isFunctionLike(ancestor)) break;
    ancestor = ancestor.parent ?? null;
  }
  let didFindFocusManager = false;
  walkAst(scopeOwner, (child: EsTreeNode) => {
    if (didFindFocusManager) return false;
    if (!isNodeOfType(child, "JSXOpeningElement")) return;
    const nameText = getJsxNameText(child.name);
    if (nameText && nameText.includes("FocusManager")) {
      didFindFocusManager = true;
      return false;
    }
  });
  return didFindFocusManager;
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
      if (isManagedFocusSurface(node)) return;
      if (isSkipNavComponent(node)) return;
      if (rendersFocusManagerInSameFunction(node)) return;

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
