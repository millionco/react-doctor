import { defineRule } from "../../utils/define-rule.js";
import { getJsxPropStringValue } from "../../utils/get-jsx-prop-string-value.js";
import { hasJsxPropIgnoreCase } from "../../utils/has-jsx-prop-ignore-case.js";
import { hasJsxSpreadAttribute } from "../../utils/has-jsx-spread-attribute.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

const MESSAGE =
  "This dialog has no accessible name, so screen readers announce it as just \u201cdialog.\u201d Add `aria-label` or point `aria-labelledby` at its heading.";

const DIALOG_ROLES = new Set(["dialog", "alertdialog"]);

// A dialog's accessible name must come from `aria-label`, `aria-labelledby`,
// or `title` — unlike most elements it gets no name from its text content. We
// treat the presence of any of these (even a dynamic value) as named and stay
// quiet; only a dialog with none of them is flagged.
const NAME_PROVIDING_ATTRIBUTES = ["aria-label", "aria-labelledby", "title"] as const;

export const dialogHasAccessibleName = defineRule({
  id: "dialog-has-accessible-name",
  title: "Dialog without accessible name",
  severity: "warn",
  recommendation:
    'Give every `<dialog>` / `role="dialog"` an accessible name with `aria-label` or `aria-labelledby` (referencing the dialog\'s title element).',
  create: (context) => ({
    JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
      if (!isNodeOfType(node.name, "JSXIdentifier")) return;
      const tagName = node.name.name;
      // Custom components (`<Modal>`) own their internal DOM — we can't verify
      // whether they wire up a name, so only intrinsic lowercase elements.
      if (tagName[0] !== tagName[0]?.toLowerCase()) return;

      const roleAttribute = hasJsxPropIgnoreCase(node.attributes, "role");
      const roleValue = roleAttribute ? getJsxPropStringValue(roleAttribute) : null;
      const isDialog = tagName === "dialog" || (roleValue !== null && DIALOG_ROLES.has(roleValue));
      if (!isDialog) return;

      // A spread could supply `aria-label`; don't risk a false positive.
      if (hasJsxSpreadAttribute(node.attributes)) return;

      const hasName = NAME_PROVIDING_ATTRIBUTES.some((attribute) =>
        hasJsxPropIgnoreCase(node.attributes, attribute),
      );
      if (hasName) return;

      context.report({ node: node.name, message: MESSAGE });
    },
  }),
});
