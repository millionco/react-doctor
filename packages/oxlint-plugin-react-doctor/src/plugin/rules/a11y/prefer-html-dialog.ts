import { HTML_TAGS } from "../../constants/html-tags.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findJsxAttribute } from "../../utils/find-jsx-attribute.js";
import { flattenCalleeName } from "../../utils/flatten-callee-name.js";
import { getJsxPropStaticStringValues } from "../../utils/get-jsx-prop-static-string-values.js";
import { getJsxPropStringValue } from "../../utils/get-jsx-prop-string-value.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isTestlikeFilename } from "../../utils/is-testlike-filename.js";
import type { RuleVisitors } from "../../utils/rule-visitors.js";
import { walkAst } from "../../utils/walk-ast.js";

const ROLE_DIALOG_VALUES = new Set(["dialog", "alertdialog"]);

// `role="dialog"` PLUS a modal signal (`aria-modal`): the author is
// hand-rolling a modal, so the focus-trap/Escape/backdrop pitch applies.
const ROLE_DIALOG_MODAL_MESSAGE =
  'Keyboard users can tab out of this `role="dialog"` modal because it has no built-in focus trapping, so use the native `<dialog>`, which gives you focus trapping, `Escape` to close, and the backdrop for free.';

// `role="dialog"` WITHOUT a modal signal is a legitimate non-modal
// dialog, so don't claim it traps focus — just point at the native
// `<dialog>`, which exposes the role and gives `.show()`/`.showModal()`.
const ROLE_DIALOG_NONMODAL_MESSAGE =
  'Screen reader users get native dialog semantics for free from the HTML `<dialog>` element, so swap this `role="dialog"` element for `<dialog>` and open it with `dialog.show()` (non-modal) or `dialog.showModal()` (modal).';

const ARIA_MODAL_MESSAGE =
  'Keyboard users can tab out of this modal because `aria-modal="true"` only hints to screen readers without trapping focus or blocking the page, so use the native `<dialog>` with `dialog.showModal()` instead.';

// "trap" must appear next to a focus/a11y word: `FocusTrap`, `useFocusTrap`,
// `trapFocus`, `a11yTrap` — but not `trapezoid` or `calculateTrap`.
const FOCUS_TRAP_NAME_PATTERN = /focus[-_]?trap|trap[-_]?focus|a11y[-_]?trap/i;

const isTabKeyLiteral = (node: EsTreeNode): boolean =>
  isNodeOfType(node, "Literal") && node.value === "Tab";

// `event.key === "Tab"` (either operand order) — the shape of a manual
// focus-trap keydown handler. A bare `"Tab"` string elsewhere (tab-bar
// labels, `<Tab>` components) is not a trapping signal.
const isTabKeyComparison = (node: EsTreeNode): boolean => {
  if (!isNodeOfType(node, "BinaryExpression")) return false;
  if (
    node.operator !== "===" &&
    node.operator !== "==" &&
    node.operator !== "!==" &&
    node.operator !== "!="
  ) {
    return false;
  }
  return isTabKeyLiteral(node.left) || isTabKeyLiteral(node.right);
};

// The diagnostic's core claim is "keyboard users can tab out because there
// is no focus trapping". When THIS dialog demonstrably traps focus —
// a focus-trap library wrapper (`<FocusTrap>`), a `useFocusTrap`-style ref
// wired to the element or an ancestor, or a manual `Tab`-key handler
// (`event.key === "Tab"` wrapping) it references — that claim is false and
// the hand-rolled dialog is a deliberate, working implementation, so stay
// quiet. A trap that is provably wired to a DIFFERENT element in the same
// file does not protect this dialog, so it no longer suppresses file-wide.
interface FocusTrapSignals {
  // Refs holding a trap (`const modalRef = useFocusTrap(…)`) plus bare /
  // member-root identifiers passed into the trap factory
  // (`createFocusTrap(modalRef.current)`).
  trapRefNames: Set<string>;
  // Named non-component functions whose body compares against `"Tab"` —
  // a manual trap the element opts into by referencing the name.
  scopedHandlerNames: Set<string>;
  // A trap signal we cannot attribute to a specific element (e.g.
  // `useEffect(() => trapFocus(ref.current))` in the component body):
  // suppress conservatively, as before the element scoping.
  hasUnscopedTrapSignal: boolean;
}

const isFunctionNode = (node: EsTreeNode): boolean =>
  isNodeOfType(node, "FunctionDeclaration") ||
  isNodeOfType(node, "FunctionExpression") ||
  isNodeOfType(node, "ArrowFunctionExpression");

const getEnclosingFunctionName = (functionNode: EsTreeNode): string | null => {
  if (isNodeOfType(functionNode, "FunctionDeclaration") && functionNode.id) {
    return functionNode.id.name;
  }
  const parent = functionNode.parent;
  if (!parent) return null;
  if (isNodeOfType(parent, "VariableDeclarator") && isNodeOfType(parent.id, "Identifier")) {
    return parent.id.name;
  }
  if (isNodeOfType(parent, "Property") && isNodeOfType(parent.key, "Identifier")) {
    return parent.key.name;
  }
  return null;
};

const COMPONENT_OR_HOOK_NAME_PATTERN = /^(?:[A-Z]|use[A-Z])/;

// Attribute a trap signal to where it attaches: a JSX attribute /
// element name is element-scoped (the per-element subtree walk finds it),
// a named handler function is scoped to references of that name, and
// anything else (component-body statements, doubly-nested anonymous
// functions) is unscoped.
const classifyTrapSignal = (signal: EsTreeNode, signals: FocusTrapSignals): void => {
  let sawAnonymousFunction = false;
  let current: EsTreeNode | null | undefined = signal.parent;
  while (current) {
    if (isNodeOfType(current, "ImportDeclaration")) return;
    if (
      isNodeOfType(current, "JSXAttribute") ||
      isNodeOfType(current, "JSXOpeningElement") ||
      isNodeOfType(current, "JSXClosingElement")
    ) {
      return;
    }
    if (isFunctionNode(current)) {
      const name = getEnclosingFunctionName(current);
      if (name && !COMPONENT_OR_HOOK_NAME_PATTERN.test(name)) {
        signals.scopedHandlerNames.add(name);
        return;
      }
      if (sawAnonymousFunction || name) break;
      sawAnonymousFunction = true;
    }
    current = current.parent;
  }
  signals.hasUnscopedTrapSignal = true;
};

const collectFocusTrapSignals = (program: EsTreeNode): FocusTrapSignals => {
  const signals: FocusTrapSignals = {
    trapRefNames: new Set(),
    scopedHandlerNames: new Set(),
    hasUnscopedTrapSignal: false,
  };
  walkAst(program, (node) => {
    if (isNodeOfType(node, "ImportDeclaration")) return false;
    if (isNodeOfType(node, "VariableDeclarator") && node.init) {
      const init = node.init;
      if (isNodeOfType(init, "CallExpression")) {
        const calleeName = flattenCalleeName(init.callee);
        if (
          calleeName &&
          FOCUS_TRAP_NAME_PATTERN.test(calleeName) &&
          isNodeOfType(node.id, "Identifier")
        ) {
          signals.trapRefNames.add(node.id.name);
          for (const argument of init.arguments) {
            const argumentNode = argument as EsTreeNode;
            if (isNodeOfType(argumentNode, "Identifier")) {
              signals.trapRefNames.add(argumentNode.name);
            } else if (
              isNodeOfType(argumentNode, "MemberExpression") &&
              isNodeOfType(argumentNode.object, "Identifier")
            ) {
              signals.trapRefNames.add(argumentNode.object.name);
            }
          }
          return false;
        }
      }
    }
    if (
      (isNodeOfType(node, "Identifier") || isNodeOfType(node, "JSXIdentifier")) &&
      FOCUS_TRAP_NAME_PATTERN.test(node.name)
    ) {
      classifyTrapSignal(node, signals);
      return;
    }
    if (isTabKeyComparison(node)) {
      classifyTrapSignal(node, signals);
      return false;
    }
  });
  return signals;
};

const containsTrapSignal = (root: EsTreeNode, signals: FocusTrapSignals): boolean => {
  let found = false;
  walkAst(root, (node) => {
    if (found) return false;
    if (isNodeOfType(node, "Identifier") || isNodeOfType(node, "JSXIdentifier")) {
      if (
        FOCUS_TRAP_NAME_PATTERN.test(node.name) ||
        signals.trapRefNames.has(node.name) ||
        signals.scopedHandlerNames.has(node.name)
      ) {
        found = true;
        return false;
      }
    }
    if (isTabKeyComparison(node)) {
      found = true;
      return false;
    }
  });
  return found;
};

const isElementFocusTrapped = (
  node: EsTreeNodeOfType<"JSXOpeningElement">,
  signals: FocusTrapSignals,
): boolean => {
  if (signals.hasUnscopedTrapSignal) return true;
  let current: EsTreeNode | null | undefined = node.parent;
  let isOwnElement = true;
  while (current) {
    if (isNodeOfType(current, "JSXElement")) {
      // The element's own subtree may wire the trap anywhere inside;
      // ancestors only count via their opening tag (a `<FocusTrap>`
      // wrapper or a trap ref on the wrapper) so a sibling dialog's
      // trap doesn't bleed over.
      const scopeRoot = isOwnElement ? current : (current.openingElement as EsTreeNode);
      if (containsTrapSignal(scopeRoot, signals)) return true;
      isOwnElement = false;
    }
    current = current.parent;
  }
  return false;
};

const isAriaModalTrue = (attribute: EsTreeNodeOfType<"JSXAttribute">): boolean => {
  const stringValue = getJsxPropStringValue(attribute);
  if (stringValue !== null) {
    return stringValue === "true";
  }
  const value = attribute.value;
  // Boolean shorthand: `<div aria-modal>` is JSX sugar for `aria-modal={true}`.
  if (!value) return true;
  if (isNodeOfType(value, "JSXExpressionContainer")) {
    const expression = value.expression;
    if (isNodeOfType(expression, "Literal") && expression.value === true) return true;
  }
  // Dynamic / non-literal expressions (`aria-modal={isOpen}`) cannot be
  // statically resolved; skip rather than risk a false positive.
  return false;
};

// Modern browsers ship a first-class modal primitive: the HTML `<dialog>`
// element. Calling `dialog.showModal()` puts it in the top layer, traps
// focus, listens for `Escape`, paints `::backdrop`, and surfaces correctly
// to assistive tech — every one of which custom `<div role="dialog">`
// implementations have to reinvent (and historically get wrong: focus
// escaping, scroll bleed, missing `aria-modal`, broken `Escape` on iOS,
// no top-layer stacking).
//
// We flag two patterns that signal a hand-rolled modal:
//
//   1. `role="dialog"` (or `role="alertdialog"`) on any non-`<dialog>`
//      element. The author has explicitly typed the role; it's the
//      strongest signal we can lift statically.
//   2. `aria-modal="true"` on a non-`<dialog>` element. `aria-modal`
//      alone does NOT trap focus or block the background — it only tells
//      assistive tech to ignore the rest of the page. Authors usually
//      reach for it expecting modal behaviour they then have to layer on
//      themselves.
//
// `<dialog>` carrying these attributes is fine — `<dialog role="dialog">`
// is redundant but not harmful, and `<dialog aria-modal="true">` is the
// documented manual override for older AT.
//
// Bonus: pairs with the upcoming `command` / `commandfor` attributes
// (Chrome 135+) — the `<button commandfor="my-dialog" command="show-modal">`
// pattern is the future declarative replacement for ad-hoc
// `onClick={() => setOpen(true)}` modal toggles. We don't lint the
// `command` side yet — it's too new — but the recommendation in this
// rule's diagnostic mentions it so users have a path forward.
export const preferHtmlDialog = defineRule({
  id: "prefer-html-dialog",
  title: "Custom modal instead of dialog",
  severity: "warn",
  recommendation:
    'Replace the wrapper with `<dialog>` and open it with `dialog.showModal()`. For the trigger, prefer `<button commandfor="id" command="show-modal">` (Chrome 135+), or a `useRef` with `dialogRef.current?.showModal()`.',
  create: (context): RuleVisitors => {
    if (isTestlikeFilename(context.filename)) return {};
    let focusTrapSignals: FocusTrapSignals | null = null;
    return {
      Program(node: EsTreeNodeOfType<"Program">) {
        focusTrapSignals = collectFocusTrapSignals(node);
      },
      JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
        if (!isNodeOfType(node.name, "JSXIdentifier")) return;
        const tagName = node.name.name;
        // Native `<dialog>` is the destination, not the source — never flag.
        if (tagName === "dialog") return;
        // Capitalised names are user components: a custom `<Dialog>` is
        // exactly the wrapper authors should be replacing, but we can't
        // know whether it itself renders a `<dialog>` underneath. Static
        // checks stay on lowercase host elements.
        if (tagName.length === 0 || tagName[0] !== tagName[0].toLowerCase()) return;
        // Custom web components (`<ui-modal>`) are opaque host elements we
        // can't reason about — only lint real HTML tags, matching the
        // sibling `scope` / `no-static-element-interactions` rules.
        if (!HTML_TAGS.has(tagName)) return;

        // Per-attribute reporting: when both `role` and `aria-modal` are
        // on the same element, the role is the more direct signal of a
        // hand-rolled modal — flag it and stop, so the user sees one
        // diagnostic per offending element instead of two.
        const roleAttribute = findJsxAttribute(node.attributes, "role");
        if (roleAttribute) {
          // Static resolution covers `role={isAlert ? "alertdialog" :
          // "dialog"}` and const-bound roles. The element is only
          // definitely a hand-rolled dialog when EVERY candidate is a
          // dialog role — a `role={open ? "dialog" : "presentation"}`
          // toggle stays silent.
          const roleCandidates = getJsxPropStaticStringValues(roleAttribute, context.scopes);
          if (
            roleCandidates !== null &&
            roleCandidates.length > 0 &&
            roleCandidates.every((candidate) => ROLE_DIALOG_VALUES.has(candidate))
          ) {
            if (focusTrapSignals && isElementFocusTrapped(node, focusTrapSignals)) return;
            const ariaModalAttribute = findJsxAttribute(node.attributes, "aria-modal");
            const isModal = ariaModalAttribute ? isAriaModalTrue(ariaModalAttribute) : false;
            context.report({
              node: roleAttribute,
              message: isModal ? ROLE_DIALOG_MODAL_MESSAGE : ROLE_DIALOG_NONMODAL_MESSAGE,
            });
            return;
          }
        }

        const ariaModalAttribute = findJsxAttribute(node.attributes, "aria-modal");
        if (ariaModalAttribute && isAriaModalTrue(ariaModalAttribute)) {
          if (focusTrapSignals && isElementFocusTrapped(node, focusTrapSignals)) return;
          context.report({ node: ariaModalAttribute, message: ARIA_MODAL_MESSAGE });
        }
      },
    };
  },
});
