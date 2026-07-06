import { HTML_TAGS } from "../../constants/html-tags.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getElementType } from "../../utils/get-element-type.js";
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
    roles: ruleSettings.roles ?? ["tabpanel", "region"],
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
