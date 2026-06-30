import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getElementType } from "../../utils/get-element-type.js";
import { getJsxPropStringValue } from "../../utils/get-jsx-prop-string-value.js";
import { hasJsxPropIgnoreCase } from "../../utils/has-jsx-prop-ignore-case.js";
import { getTagsForRole } from "../../constants/aria-element-roles.js";

const buildMessage = (role: string, tag: string): string =>
  `Screen reader users get more reliable semantics from \`<${tag}>\` than \`role="${role}"\`, so use \`<${tag}>\` instead.`;

// Composite-widget roles whose first "matching tag" is NOT a drop-in
// standalone replacement: `role="listbox"` reverse-maps to `<datalist>`
// / `<select>`, but `<datalist>` only works as an `<input list>`
// autocomplete source and `<select>` is a native form control — neither
// substitutes for a custom navigable results widget (wired via
// aria-controls / aria-activedescendant). Same for `combobox`. `option`
// is the child role of those widgets: a native `<option>` only renders
// inside `<select>`/`<datalist>`/`<optgroup>` and accepts text only, so a
// `<div role="option">` holding arbitrary JSX in a custom listbox cannot
// become one. Suggesting the tag here is semantically wrong, so we don't
// flag these roles.
const COMPOSITE_WIDGET_ROLES: ReadonlySet<string> = new Set(["listbox", "combobox", "option"]);

// Roles whose first reverse-mapped tag is wrong, semantically loaded, or
// otherwise NOT a safe drop-in for a generic `div`/`span` container:
//   - `group`   → `<address>` (contact-info element — nonsensical; the only
//                 real `group` element is the form-specific `<fieldset>`).
//   - `region`  → `<section>`, which only exposes the `region` role when it
//                 carries an accessible name.
//   - `img`     → `<img>`, a void element that cannot contain children; a
//                 `<div|span role="img">` is the compose-an-image-from-non-img
//                 -content idiom (icon font / inline SVG / spinner) with no src.
//   - `dialog`  → `<dialog>`, which has top-layer/`.showModal()` behavior that
//                 a portal+aria custom dialog can't adopt without a rewrite.
//   - `status`  → `<output>`, a form-association element for calculation
//                 results — not a drop-in for a generic live-region status.
// Suggesting any of these would mislead, so skip the roles.
const STRUCTURAL_ROLES_WITHOUT_CLEAN_TAG: ReadonlySet<string> = new Set([
  "group",
  "region",
  "img",
  "dialog",
  "status",
]);

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
      if (COMPOSITE_WIDGET_ROLES.has(role) || STRUCTURAL_ROLES_WITHOUT_CLEAN_TAG.has(role)) return;
      const matchingTags = getTagsForRole(role);
      if (matchingTags.length === 0) return;
      const preferred = matchingTags[0]!;
      context.report({ node: roleAttr, message: buildMessage(role, preferred) });
    },
  }),
});
