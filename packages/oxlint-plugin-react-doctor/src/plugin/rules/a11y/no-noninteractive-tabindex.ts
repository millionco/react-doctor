import { HTML_TAGS } from "../../constants/html-tags.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getElementType } from "../../utils/get-element-type.js";
import { hasJsxPropIgnoreCase } from "../../utils/has-jsx-prop-ignore-case.js";
import { isInteractiveElement } from "../../utils/is-interactive-element.js";
import { isInteractiveRole } from "../../utils/is-interactive-role.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
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

// `tabIndex={active ? 0 : -1}` is the roving-tabindex pattern: only one
// element in the composite is tabbable at a time, and the `-1` branch keeps
// the rest reachable by script. The `tabIndex` is intentional, so skip it.
const isRovingTabindexValue = (value: EsTreeNode): boolean => {
  if (!isNodeOfType(value, "JSXExpressionContainer")) return false;
  const expression = value.expression;
  if (!isNodeOfType(expression, "ConditionalExpression")) return false;
  if (isNodeOfType(expression.test, "Literal")) return false;
  const branchValues = [
    parseNumericBranch(expression.consequent),
    parseNumericBranch(expression.alternate),
  ];
  return branchValues.some((branchValue) => branchValue !== null && branchValue < 0);
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
    roles: ruleSettings.roles ?? ["tabpanel"],
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
    return {
      JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
        const tabIndex = hasJsxPropIgnoreCase(node.attributes, "tabIndex");
        if (!tabIndex) return;
        const tabIndexValue = tabIndex.value as EsTreeNode | null;
        if (!tabIndexValue) return;
        if (isRovingTabindexValue(tabIndexValue)) return;
        const numeric = parseJsxValue(tabIndexValue);
        if (numeric === null) {
          if (
            isNodeOfType(tabIndexValue, "JSXExpressionContainer") &&
            !settings.allowExpressionValues &&
            !isKeyboardOperable(node)
          ) {
            context.report({ node: tabIndex, message: MESSAGE });
          }
          return;
        }
        if (numeric < 0 || numeric % 1 !== 0) return;

        const elementType = getElementType(node, context.settings);
        if (settings.tags.includes(elementType)) return;
        if (!HTML_TAGS.has(elementType)) return;
        if (isInteractiveElement(elementType, node)) return;
        if (isKeyboardOperable(node)) return;

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
