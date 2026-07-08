import { HTML_TAGS } from "../../constants/html-tags.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { flattenJsxName } from "../../utils/flatten-jsx-name.js";
import { getElementType } from "../../utils/get-element-type.js";
import { getJsxAttributeName } from "../../utils/get-jsx-attribute-name.js";
import { getJsxPropStringValue } from "../../utils/get-jsx-prop-string-value.js";
import { hasJsxPropIgnoreCase } from "../../utils/has-jsx-prop-ignore-case.js";
import { hasJsxSpreadAttribute } from "../../utils/has-jsx-spread-attribute.js";
import { isInteractiveElement } from "../../utils/is-interactive-element.js";
import { isInteractiveRole } from "../../utils/is-interactive-role.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isTestlikeFilename } from "../../utils/is-testlike-filename.js";
import { parseJsxValue } from "../../utils/parse-jsx-value.js";

const MESSAGE =
  "Keyboard users get stuck focusing this element they can't act on because `tabIndex` makes it tabbable, so remove it.";

// A focusable container that ALSO wires a keyboard handler is operable by
// design (roving focus, modal autofocus), so the `tabIndex` is intentional.
const KEYBOARD_HANDLER_PROP_NAMES: ReadonlyArray<string> = ["onKeyDown", "onKeyUp", "onKeyPress"];

const isKeyboardOperable = (node: EsTreeNodeOfType<"JSXOpeningElement">): boolean =>
  KEYBOARD_HANDLER_PROP_NAMES.some((propName) =>
    Boolean(hasJsxPropIgnoreCase(node.attributes, propName)),
  );

// A focus handler means focusing the element DOES something (tooltip
// trigger, focus-trap sentinel redirect), so it isn't an inert tab stop.
const FOCUS_HANDLER_PROP_NAMES: ReadonlyArray<string> = ["onFocus", "onBlur"];

const isFocusOperable = (node: EsTreeNodeOfType<"JSXOpeningElement">): boolean =>
  FOCUS_HANDLER_PROP_NAMES.some((propName) =>
    Boolean(hasJsxPropIgnoreCase(node.attributes, propName)),
  );

// An accessible name means focusing announces information — the
// keyboard-accessible-tooltip / named-region pattern, not a dead stop.
const hasAccessibleName = (node: EsTreeNodeOfType<"JSXOpeningElement">): boolean =>
  Boolean(
    hasJsxPropIgnoreCase(node.attributes, "aria-label") ||
    hasJsxPropIgnoreCase(node.attributes, "aria-labelledby"),
  );

const TOOLTIP_LIKE_COMPONENT_PATTERN = /tooltip|popover/i;

const isTooltipLikeElement = (element: EsTreeNodeOfType<"JSXElement">): boolean => {
  const name = flattenJsxName(element.openingElement.name as EsTreeNode);
  return name !== null && TOOLTIP_LIKE_COMPONENT_PATTERN.test(name);
};

// A focusable element adjacent to a tooltip/popover — its direct JSX
// parent, a direct child, or the variable it's assigned to being named
// `trigger` — is the keyboard-accessible-tooltip trigger pattern: focus
// is what reveals the tooltip, so the tabIndex is deliberate.
const isTooltipTrigger = (node: EsTreeNodeOfType<"JSXOpeningElement">): boolean => {
  const element = node.parent;
  if (!element || !isNodeOfType(element, "JSXElement")) return false;
  for (const child of element.children) {
    if (isNodeOfType(child as EsTreeNode, "JSXElement")) {
      if (isTooltipLikeElement(child as EsTreeNodeOfType<"JSXElement">)) return true;
    }
  }
  let current: EsTreeNode | null | undefined = element.parent;
  while (current) {
    if (isNodeOfType(current, "JSXElement")) return isTooltipLikeElement(current);
    if (isNodeOfType(current, "VariableDeclarator")) {
      const id = current.id as EsTreeNode;
      return isNodeOfType(id, "Identifier") && /trigger/i.test(id.name);
    }
    if (
      !isNodeOfType(current, "JSXExpressionContainer") &&
      !isNodeOfType(current, "JSXFragment") &&
      (current as { type: string }).type !== "ParenthesizedExpression"
    ) {
      return false;
    }
    current = current.parent ?? null;
  }
  return false;
};

// `overflow: auto/scroll` containers are the WCAG focusable-scroll-region
// pattern (SC 2.1.1): keyboard users need focus on the container to
// scroll it, so tabIndex={0} there is recommended, not a defect.
const SCROLLABLE_CLASS_PATTERN = /(?:^|[\s:])overflow(?:-[xy])?-(?:auto|scroll)(?:$|\s)/;

const hasScrollableClassName = (node: EsTreeNodeOfType<"JSXOpeningElement">): boolean => {
  const classNameAttribute = hasJsxPropIgnoreCase(node.attributes, "className");
  if (!classNameAttribute) return false;
  const classNameValue = getJsxPropStringValue(classNameAttribute);
  return classNameValue !== null && SCROLLABLE_CLASS_PATTERN.test(classNameValue);
};

// A ref plus native mouse/pointer handlers marks a library-managed
// interactive surface (OpenLayers/Leaflet map containers, canvas hosts):
// the library attaches its keyboard interactions to the DOM node
// directly, so the element must stay focusable.
const MOUSE_HANDLER_PROP_NAMES: ReadonlyArray<string> = [
  "onMouseDown",
  "onMouseUp",
  "onMouseMove",
  "onContextMenu",
  "onPointerDown",
  "onPointerUp",
  "onPointerMove",
  "onWheel",
];

const isLibraryManagedInteractiveSurface = (node: EsTreeNodeOfType<"JSXOpeningElement">): boolean =>
  Boolean(hasJsxPropIgnoreCase(node.attributes, "ref")) &&
  MOUSE_HANDLER_PROP_NAMES.some((propName) =>
    Boolean(hasJsxPropIgnoreCase(node.attributes, propName)),
  );

// Attributes that don't change what a childless focusable div IS —
// a focus-trap sentinel bracketing dialog content.
const SENTINEL_ALLOWED_ATTRIBUTE_PATTERN =
  /^(?:tabindex|ref|key|style|classname|aria-hidden|data-.*)$/i;

// `<div tabIndex={0} />` with no children and no behavior, rendered
// among siblings inside a container, is the invisible focus-trap
// sentinel pattern — removing it would break the trap.
const isFocusTrapSentinel = (
  node: EsTreeNodeOfType<"JSXOpeningElement">,
  element: EsTreeNode | null | undefined,
): boolean => {
  if (!node.selfClosing) return false;
  for (const attribute of node.attributes) {
    if (!isNodeOfType(attribute as EsTreeNode, "JSXAttribute")) return false;
    const attributeName = getJsxAttributeName(
      (attribute as EsTreeNodeOfType<"JSXAttribute">).name as EsTreeNode,
    );
    if (!attributeName || !SENTINEL_ALLOWED_ATTRIBUTE_PATTERN.test(attributeName)) return false;
  }
  if (!element || !isNodeOfType(element, "JSXElement")) return false;
  const container = element.parent;
  if (!container || !isNodeOfType(container, "JSXElement")) return false;
  return container.children.some(
    (sibling) => sibling !== element && isNodeOfType(sibling as EsTreeNode, "JSXElement"),
  );
};

const parseNumericBranch = (expression: EsTreeNode): number | null => {
  if (isNodeOfType(expression, "Literal") && typeof expression.value === "number") {
    return expression.value;
  }
  if (
    isNodeOfType(expression, "UnaryExpression") &&
    expression.operator === "-" &&
    isNodeOfType(expression.argument, "Literal") &&
    typeof expression.argument.value === "number"
  ) {
    return -expression.argument.value;
  }
  return null;
};

// A branch that resolves to `undefined`/`null`/`false` renders no
// tabIndex attribute at all — the element is only focusable in the
// other branch.
const isNonFocusableBranch = (expression: EsTreeNode): boolean => {
  if (isNodeOfType(expression, "Literal")) {
    return expression.value === null || expression.value === false;
  }
  if (isNodeOfType(expression, "Identifier")) return expression.name === "undefined";
  return isNodeOfType(expression, "UnaryExpression") && expression.operator === "void";
};

// `tabIndex={active ? 0 : -1}` is the roving-tabindex pattern, and
// `tabIndex={isScrollable ? 0 : undefined}` is conditional focusability
// (only tabbable in the state where focus is useful). Either way one
// branch deliberately opts out of the tab order, so the `tabIndex` is
// intentional — skip it.
const isConditionallyTabbableValue = (value: EsTreeNode): boolean => {
  if (!isNodeOfType(value, "JSXExpressionContainer")) return false;
  const expression = value.expression;
  if (!isNodeOfType(expression, "ConditionalExpression")) return false;
  if (isNodeOfType(expression.test, "Literal")) return false;
  const branches = [expression.consequent as EsTreeNode, expression.alternate as EsTreeNode];
  return branches.some((branch) => {
    const numericValue = parseNumericBranch(branch);
    return (numericValue !== null && numericValue < 0) || isNonFocusableBranch(branch);
  });
};

interface NoNoninteractiveTabindexSettings {
  tags?: ReadonlyArray<string>;
  roles?: ReadonlyArray<string>;
  allowExpressionValues?: boolean;
}

const resolveSettings = (
  settings: Readonly<Record<string, unknown>> | undefined,
): Required<NoNoninteractiveTabindexSettings> => {
  const reactDoctor = settings?.["react-doctor"];
  const ruleSettings =
    typeof reactDoctor === "object" && reactDoctor !== null
      ? ((reactDoctor as { noNoninteractiveTabindex?: NoNoninteractiveTabindexSettings })
          .noNoninteractiveTabindex ?? {})
      : {};
  return {
    tags: ruleSettings.tags ?? [],
    // `region` beyond upstream's `tabpanel`: a named scrollable region
    // with tabIndex is the WCAG focusable-scroll-region pattern.
    // `dialog`/`alertdialog`: a focusable dialog container is standard
    // focus management (focus moves to the dialog when it opens).
    roles: ruleSettings.roles ?? ["tabpanel", "region", "dialog", "alertdialog"],
    allowExpressionValues: ruleSettings.allowExpressionValues ?? true,
  };
};

// Port of `oxc_linter::rules::jsx_a11y::no_noninteractive_tabindex`.
export const noNoninteractiveTabindex = defineRule({
  id: "no-noninteractive-tabindex",
  title: "Tabindex on non-interactive element",
  tags: ["react-jsx-only"],
  severity: "warn",
  recommendation: "Only add `tabIndex` to interactive elements or interactive roles.",
  category: "Accessibility",
  create: (context) => {
    const settings = resolveSettings(context.settings);
    const isTestlikeFile = isTestlikeFilename(context.filename);
    return {
      JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
        if (isTestlikeFile) return;
        const tabIndex = hasJsxPropIgnoreCase(node.attributes, "tabIndex");
        if (!tabIndex) return;
        const tabIndexValue = tabIndex.value as EsTreeNode | null;
        if (!tabIndexValue) return;
        if (isConditionallyTabbableValue(tabIndexValue)) return;
        const numeric = parseJsxValue(tabIndexValue);
        if (numeric === null) {
          if (
            isNodeOfType(tabIndexValue, "JSXExpressionContainer") &&
            !settings.allowExpressionValues &&
            !isKeyboardOperable(node) &&
            !isFocusOperable(node) &&
            !hasJsxSpreadAttribute(node.attributes)
          ) {
            context.report({ node: tabIndex, message: MESSAGE });
          }
          return;
        }
        if (numeric < 0 || numeric % 1 !== 0) return;

        const elementType = getElementType(node, context.settings);
        if (settings.tags.includes(elementType)) return;
        if (!HTML_TAGS.has(elementType)) return;
        // A <pre> with tabIndex is the focusable scrollable code block —
        // keyboard users need focus to scroll it.
        if (elementType === "pre") return;
        if (isInteractiveElement(elementType, node)) return;
        if (isKeyboardOperable(node)) return;
        if (isFocusOperable(node)) return;
        // A spread can supply role / handlers at runtime (floating-ui
        // `getReferenceProps()`, downshift `getToggleButtonProps()`), so
        // the element can't be proven non-interactive.
        if (hasJsxSpreadAttribute(node.attributes)) return;
        if (hasAccessibleName(node)) return;
        if (isTooltipTrigger(node)) return;
        if (hasScrollableClassName(node)) return;
        if (isLibraryManagedInteractiveSurface(node)) return;
        if (isFocusTrapSentinel(node, node.parent)) return;

        const roleAttribute = hasJsxPropIgnoreCase(node.attributes, "role");
        if (!roleAttribute) {
          context.report({ node: tabIndex, message: MESSAGE });
          return;
        }
        const roleValue = roleAttribute.value as EsTreeNode | null;
        if (roleValue) {
          if (isNodeOfType(roleValue, "Literal") && typeof roleValue.value === "string") {
            const firstRole = roleValue.value.split(/\s+/)[0];
            if (firstRole && (isInteractiveRole(firstRole) || settings.roles.includes(firstRole))) {
              return;
            }
          }
          if (isNodeOfType(roleValue, "JSXExpressionContainer") && settings.allowExpressionValues) {
            return;
          }
        }
        context.report({ node: tabIndex, message: MESSAGE });
      },
    };
  },
});
