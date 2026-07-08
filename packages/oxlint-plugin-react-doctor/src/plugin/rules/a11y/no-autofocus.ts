import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { flattenJsxName } from "../../utils/flatten-jsx-name.js";
import { getElementType } from "../../utils/get-element-type.js";
import { getJsxPropStringValue } from "../../utils/get-jsx-prop-string-value.js";
import { getStaticTemplateLiteralValue } from "../../utils/get-static-template-literal-value.js";
import { hasJsxPropIgnoreCase } from "../../utils/has-jsx-prop-ignore-case.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isTestlikeFilename } from "../../utils/is-testlike-filename.js";
import { HTML_TAGS } from "../../constants/html-tags.js";

const MESSAGE =
  "`autoFocus` moves focus on load, which can disrupt screen reader and keyboard users. Remove it and let users choose where to focus.";

interface NoAutofocusSettings {
  ignoreNonDOM?: boolean;
}

const resolveSettings = (
  settings: Readonly<Record<string, unknown>> | undefined,
): Required<NoAutofocusSettings> => {
  const reactDoctor = settings?.["react-doctor"];
  const ruleSettings =
    typeof reactDoctor === "object" && reactDoctor !== null
      ? ((reactDoctor as { noAutofocus?: NoAutofocusSettings }).noAutofocus ?? {})
      : {};
  // Default to `true`: `autoFocus` on a CUSTOM component is the
  // consumer delegating focus to a wrapper that itself manages how /
  // when / whether to focus. The component is the right place to
  // enforce the a11y rule (its internal `<input autoFocus />` would
  // be flagged) — flagging the consumer creates noise for every
  // design-system input that forwards the prop. Match jsx-a11y's
  // multi-year default.
  return { ignoreNonDOM: ruleSettings.ignoreNonDOM ?? true };
};

// Strip parens around an expression — OXC's ESTree parser doesn't
// emit ParenthesizedExpression by default, but be defensive.
const innerExpression = (expression: EsTreeNode): EsTreeNode => {
  if (
    (expression as { type: string }).type === "ParenthesizedExpression" &&
    "expression" in expression
  ) {
    return innerExpression((expression as { expression: EsTreeNode }).expression);
  }
  return expression;
};

// `autoFocus={anything computed}` — a non-literal value means the
// component decides at runtime whether to focus (`autoFocus={!disable
// Focus}`) or forwards the consumer's flag (`autoFocus={autofocus}`).
// Both are deliberate focus management, not an unconditional page-load
// focus steal; assume them valid like `role={role}` in aria-role. The
// `undefined` identifier stays flagged to match the documented
// contract (`autoFocus={undefined}` triggers).
const isDynamicAttributeValue = (value: EsTreeNode | null): boolean => {
  if (!value || !isNodeOfType(value, "JSXExpressionContainer")) return false;
  const expression = innerExpression(value.expression as EsTreeNode);
  if (isNodeOfType(expression, "Literal")) return false;
  if (isNodeOfType(expression, "Identifier") && expression.name === "undefined") return false;
  if (
    isNodeOfType(expression, "TemplateLiteral") &&
    getStaticTemplateLiteralValue(expression) !== null
  ) {
    return false;
  }
  return true;
};

// Returns true when an attribute value is statically equivalent to
// `false` (per OXC's `is_false_attribute_value`).
const isFalseAttributeValue = (value: EsTreeNode): boolean => {
  if (isNodeOfType(value, "Literal")) {
    return typeof value.value === "string" ? value.value === "false" : value.value === false;
  }
  if (isNodeOfType(value, "JSXExpressionContainer")) {
    const expression = innerExpression(value.expression);
    if (isNodeOfType(expression, "Literal")) {
      if (typeof expression.value === "boolean") return !expression.value;
      if (typeof expression.value === "string") return expression.value === "false";
      return false;
    }
    if (isNodeOfType(expression, "TemplateLiteral")) {
      return getStaticTemplateLiteralValue(expression) === "false";
    }
  }
  return false;
};

// An element marked as a modal dialog: `aria-modal`, the native
// `<dialog>` tag, or a `role` of dialog/alertdialog. Kept deliberately
// to EXPLICIT dialog semantics — broader signals (component names like
// `*Modal`, popover/menu roles) traded true positives near 1:1 in the
// verify corpus. Conditional rendering is handled separately by
// `isConditionallyRendered` below: the docs-validation pass confirmed
// state-gated `autoFocus` (edit-in-place, user-opened panels) as the
// dominant false-positive cluster.
const MODAL_DIALOG_ROLES: ReadonlySet<string> = new Set(["dialog", "alertdialog"]);

const isModalDialogElement = (
  openingElement: EsTreeNodeOfType<"JSXOpeningElement">,
  settings: Readonly<Record<string, unknown>> | undefined,
): boolean => {
  if (flattenJsxName(openingElement.name as EsTreeNode) === "dialog") return true;
  if (hasJsxPropIgnoreCase(openingElement.attributes, "aria-modal")) return true;
  const roleAttribute = hasJsxPropIgnoreCase(openingElement.attributes, "role");
  if (roleAttribute) {
    const roleValue = getJsxPropStringValue(roleAttribute);
    if (roleValue && MODAL_DIALOG_ROLES.has(roleValue.toLowerCase())) return true;
  }
  return getElementType(openingElement, settings) === "dialog";
};

// Moving focus into a just-opened modal dialog is the WAI-ARIA APG
// recommendation ("focus moves to an element inside the dialog"), not
// an on-load focus steal — dialogs only mount in response to a user
// action, so `autoFocus` there is correct focus management.
const isInsideModalDialog = (
  node: EsTreeNodeOfType<"JSXOpeningElement">,
  settings: Readonly<Record<string, unknown>> | undefined,
): boolean => {
  let current: EsTreeNode | null | undefined = node.parent;
  while (current) {
    if (
      isNodeOfType(current, "JSXElement") &&
      isModalDialogElement(current.openingElement, settings)
    ) {
      return true;
    }
    current = current.parent ?? null;
  }
  return false;
};

const FUNCTION_BOUNDARY_TYPES: ReadonlySet<string> = new Set([
  "ArrowFunctionExpression",
  "FunctionExpression",
  "FunctionDeclaration",
]);

const CONDITIONAL_RENDER_TYPES: ReadonlySet<string> = new Set([
  "ConditionalExpression",
  "LogicalExpression",
  "IfStatement",
]);

// An element whose mount is gated on component state (`{isEditing &&
// <input autoFocus/>}`, `isSearching ? <input autoFocus/> : …`,
// `if (editing) return <input autoFocus/>`) focuses in response to a
// state change — the edit-in-place / user-opened-panel pattern, i.e.
// the doc's deliberate-focus carve-out — not on page load. Only an
// element rendered unconditionally within its component (the walk
// stops at the enclosing function) can steal focus when the page or
// route mounts, so only that shape keeps firing.
const isConditionallyRendered = (node: EsTreeNodeOfType<"JSXOpeningElement">): boolean => {
  let current: EsTreeNode | null | undefined = node.parent;
  while (current) {
    if (FUNCTION_BOUNDARY_TYPES.has(current.type)) return false;
    if (CONDITIONAL_RENDER_TYPES.has(current.type)) return true;
    current = current.parent ?? null;
  }
  return false;
};

// Port of `oxc_linter::rules::jsx_a11y::no_autofocus`. Reports any
// case-sensitive `autoFocus=` attribute on JSX elements whose value
// isn't statically `false`. With `ignoreNonDOM: true`, only HTML
// elements (lowercase tag in HTML_TAGS) are checked.
export const noAutofocus = defineRule({
  id: "no-autofocus",
  title: "Autofocus on an element",
  tags: ["react-jsx-only"],
  severity: "warn",
  recommendation: "Do not use `autoFocus`. It disorients users on load.",
  category: "Accessibility",
  create: (context) => {
    const settings = resolveSettings(context.settings);
    const isTestlikeFile = isTestlikeFilename(context.filename);
    return {
      JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
        if (isTestlikeFile) return;
        const autoFocusAttribute = node.attributes.find((attribute) => {
          if (!isNodeOfType(attribute as EsTreeNode, "JSXAttribute")) return false;
          const attributeName = (attribute as EsTreeNodeOfType<"JSXAttribute">).name;
          return (
            isNodeOfType(attributeName as EsTreeNode, "JSXIdentifier") &&
            (attributeName as EsTreeNodeOfType<"JSXIdentifier">).name === "autoFocus"
          );
        });
        if (!autoFocusAttribute) return;
        const attributeValue = (autoFocusAttribute as EsTreeNodeOfType<"JSXAttribute">)
          .value as EsTreeNode | null;
        if (attributeValue && isFalseAttributeValue(attributeValue)) return;
        if (isDynamicAttributeValue(attributeValue)) return;
        if (settings.ignoreNonDOM) {
          const tag = getElementType(node, context.settings);
          if (!HTML_TAGS.has(tag)) return;
        }
        if (isInsideModalDialog(node, context.settings)) return;
        if (isConditionallyRendered(node)) return;
        context.report({ node: autoFocusAttribute as EsTreeNode, message: MESSAGE });
      },
    };
  },
});
