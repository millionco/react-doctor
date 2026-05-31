import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findJsxAttribute } from "../../utils/find-jsx-attribute.js";
import { getJsxPropStringValue } from "../../utils/get-jsx-prop-string-value.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { Rule } from "../../utils/rule.js";

const ROLE_DIALOG_VALUES = new Set(["dialog", "alertdialog"]);

const ROLE_DIALOG_MESSAGE =
  'Keyboard users can tab out of this `role="dialog"` modal because it has no built-in focus trapping, so use the native `<dialog>`, which gives you focus trapping, `Escape` to close, and the backdrop for free.';

const ARIA_MODAL_MESSAGE =
  'Keyboard users can tab out of this modal because `aria-modal="true"` only hints to screen readers without trapping focus or blocking the page, so use the native `<dialog>` with `dialog.showModal()` instead.';

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
export const preferHtmlDialog = defineRule<Rule>({
  id: "prefer-html-dialog",
  title: "Custom modal instead of dialog",
  severity: "warn",
  recommendation:
    'Replace the wrapper with `<dialog>` and open it with `dialog.showModal()`. For the trigger, prefer `<button commandfor="id" command="show-modal">` (Chrome 135+), or a `useRef` with `dialogRef.current?.showModal()`.',
  create: (context) => ({
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

      // Per-attribute reporting: when both `role` and `aria-modal` are
      // on the same element, the role is the more direct signal of a
      // hand-rolled modal — flag it and stop, so the user sees one
      // diagnostic per offending element instead of two.
      const roleAttribute = findJsxAttribute(node.attributes, "role");
      if (roleAttribute) {
        const roleValue = getJsxPropStringValue(roleAttribute);
        if (roleValue !== null && ROLE_DIALOG_VALUES.has(roleValue)) {
          context.report({ node: roleAttribute, message: ROLE_DIALOG_MESSAGE });
          return;
        }
      }

      const ariaModalAttribute = findJsxAttribute(node.attributes, "aria-modal");
      if (ariaModalAttribute && isAriaModalTrue(ariaModalAttribute)) {
        context.report({ node: ariaModalAttribute, message: ARIA_MODAL_MESSAGE });
      }
    },
  }),
});
