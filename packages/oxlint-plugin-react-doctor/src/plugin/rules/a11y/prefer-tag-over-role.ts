import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getElementType } from "../../utils/get-element-type.js";
import { getJsxPropStringValue } from "../../utils/get-jsx-prop-string-value.js";
import { hasJsxPropIgnoreCase } from "../../utils/has-jsx-prop-ignore-case.js";
import { getTagsForRole } from "../../constants/aria-element-roles.js";

const buildMessage = (role: string, tag: string): string =>
  `Screen reader users get more reliable semantics from \`<${tag}>\` than \`role="${role}"\`, so use \`<${tag}>\` instead.`;

// Roles whose first reverse-mapped tag isn't a safe drop-in for a generic
// `div`/`span`, so we decline to suggest it:
//   - `listbox`/`combobox` → `<datalist>`/`<select>` (autocomplete source /
//                 native form control, not a custom aria-controls widget).
//   - `option`  → native `<option>` renders only inside `<select>`/`<datalist>`
//                 and is text-only, so it can't hold arbitrary JSX.
//   - `group`   → `<address>` (contact-info; the only real `group` element is
//                 the form-specific `<fieldset>`).
//   - `region`  → `<section>`, which exposes `region` only when named.
//   - `img`     → `<img>` is void and can't wrap the compose-an-image content
//                 (icon font / inline SVG / spinner) a `role="img"` div holds.
//   - `dialog`  → `<dialog>` has top-layer/`.showModal()` behavior a portal+aria
//                 custom dialog can't adopt without a rewrite.
//   - `status`  → `<output>` is a form-result element, not a live-region status.
const ROLES_WITHOUT_CLEAN_TAG: ReadonlySet<string> = new Set([
  "listbox",
  "combobox",
  "option",
  "group",
  "region",
  "img",
  "dialog",
  "status",
]);

// Roles whose first reverse-mapped tag isn't the idiomatic choice:
// `getTagsForRole("list")` returns `<menu>` first, but the conventional
// list element is `<ul>`.
const PREFERRED_TAG_OVERRIDES: Readonly<Record<string, string>> = {
  list: "ul",
};

// Attributes that turn a `role="separator"` into a focusable, valued
// window-splitter widget (the ARIA splitter pattern). A native `<hr>`
// can't take focus or carry a value, so suggesting it would break the
// widget — only a decorative (non-focusable, valueless) separator maps
// cleanly to `<hr>`.
const SPLITTER_SIGNAL_ATTRIBUTES: ReadonlyArray<string> = [
  "tabindex",
  "aria-valuenow",
  "aria-valuemin",
  "aria-valuemax",
  "aria-orientation",
];

// Port of `oxc_linter::rules::jsx_a11y::prefer_tag_over_role`. When a
// generic element (`div`/`span`) uses `role` to emulate a built-in
// element's semantics, suggest using the built-in directly.
export const preferTagOverRole = defineRule({
  id: "prefer-tag-over-role",
  title: "Role used instead of HTML tag",
  tags: ["react-jsx-only"],
  severity: "warn",
  recommendation:
    "Use the matching HTML element when one exists so browsers and assistive tech get native semantics.",
  category: "Accessibility",
  create: (context) => ({
    JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
      const tag = getElementType(node, context.settings);
      if (tag !== "div" && tag !== "span") return;
      const roleAttr = hasJsxPropIgnoreCase(node.attributes, "role");
      if (!roleAttr) return;
      const role = getJsxPropStringValue(roleAttr);
      if (!role) return;
      if (ROLES_WITHOUT_CLEAN_TAG.has(role)) return;
      if (
        role === "separator" &&
        SPLITTER_SIGNAL_ATTRIBUTES.some((attribute) =>
          hasJsxPropIgnoreCase(node.attributes, attribute),
        )
      ) {
        return;
      }
      const matchingTags = getTagsForRole(role);
      if (matchingTags.length === 0) return;
      const preferred = PREFERRED_TAG_OVERRIDES[role] ?? matchingTags[0]!;
      context.report({ node: roleAttr, message: buildMessage(role, preferred) });
    },
  }),
});
