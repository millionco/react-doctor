import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getElementType } from "../../utils/get-element-type.js";
import { getJsxPropStringValue } from "../../utils/get-jsx-prop-string-value.js";
import { hasJsxPropIgnoreCase } from "../../utils/has-jsx-prop-ignore-case.js";
import { hasJsxSpreadAttribute } from "../../utils/has-jsx-spread-attribute.js";
import { isHiddenFromScreenReader } from "../../utils/is-hidden-from-screen-reader.js";
import { isInteractiveElement } from "../../utils/is-interactive-element.js";
import { isMeaningfulJsxChild } from "../../utils/is-meaningful-jsx-child.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isTestlikeFilename } from "../../utils/is-testlike-filename.js";
import { walkAst } from "../../utils/walk-ast.js";
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

// Table-structure roles reverse-map to `<tr>`/`<tbody>`/`<th>`/`<td>` —
// elements that are only valid inside a real `<table>`. In the wild these
// roles on a div/span are almost always the sanctioned WAI-ARIA grid/table
// composite pattern (interactive calendars, virtualized data grids,
// flex-layout tables) where native table markup is impossible or would lose
// its implicit semantics to a CSS `display` override, so the swap suggestion
// is wrong far more often than right.
const TABLE_STRUCTURE_ROLES: ReadonlySet<string> = new Set([
  "row",
  "rowgroup",
  "columnheader",
  "rowheader",
  "gridcell",
  "cell",
]);

// Roles whose first reverse-mapped tag isn't the idiomatic choice:
// `getTagsForRole("list")` returns `<menu>` first, but the conventional
// list element is `<ul>`.
const PREFERRED_TAG_OVERRIDES: Readonly<Record<string, string>> = {
  list: "ul",
};

// Roles that get implemented as bespoke valued/focusable widgets — window
// splitters (`separator`), multi-thumb or drag-to-resize handles (`slider`,
// `spinbutton`). A native `<hr>`/`<input>` can't take programmatic focus,
// carry arbitrary values, or drive a drag interaction, so any focus/value/
// drag signal means the custom element is intentional.
const VALUED_WIDGET_ROLES: ReadonlySet<string> = new Set(["separator", "slider", "spinbutton"]);

const VALUED_WIDGET_SIGNAL_ATTRIBUTES: ReadonlyArray<string> = [
  "tabindex",
  "aria-valuenow",
  "aria-valuemin",
  "aria-valuemax",
  "aria-orientation",
  "onmousedown",
  "onpointerdown",
  "ontouchstart",
];

// `<hr>` and `<input>` are void, and `<progress>` renders children only as
// fallback — when the flagged element renders visible children the suggested
// tag can't preserve them.
const CHILD_REJECTING_TAGS: ReadonlySet<string> = new Set(["hr", "input", "progress"]);

// Content that can't legally live inside a native `<button>`/`<a>`: block
// (non-phrasing) elements. Nested interactive elements are handled via
// `isInteractiveElement`.
const NON_PHRASING_TAGS: ReadonlySet<string> = new Set([
  "address",
  "article",
  "aside",
  "blockquote",
  "dd",
  "details",
  "dialog",
  "div",
  "dl",
  "dt",
  "fieldset",
  "figcaption",
  "figure",
  "footer",
  "form",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "header",
  "hr",
  "li",
  "main",
  "nav",
  "ol",
  "p",
  "pre",
  "section",
  "table",
  "ul",
]);

const getEnclosingJsxElement = (
  openingElement: EsTreeNodeOfType<"JSXOpeningElement">,
): EsTreeNodeOfType<"JSXElement"> | undefined => {
  const parent = openingElement.parent;
  if (parent && isNodeOfType(parent, "JSXElement")) return parent;
  return undefined;
};

const hasMeaningfulChildren = (element: EsTreeNodeOfType<"JSXElement">): boolean =>
  element.children.some((child) => isMeaningfulJsxChild(child));

const isStructurallyIncompatibleWithNativeButton = (
  tag: string,
  openingElement: EsTreeNodeOfType<"JSXOpeningElement">,
): boolean =>
  isInteractiveElement(tag, openingElement) || tag === "label" || NON_PHRASING_TAGS.has(tag);

const hasButtonIncompatibleDescendant = (
  element: EsTreeNodeOfType<"JSXElement">,
  settings: Readonly<Record<string, unknown>> | undefined,
): boolean => {
  let found = false;
  for (const child of element.children) {
    walkAst(child, (descendant) => {
      if (found) return false;
      if (!isNodeOfType(descendant, "JSXOpeningElement")) return;
      const tag = getElementType(descendant, settings);
      if (isStructurallyIncompatibleWithNativeButton(tag, descendant)) {
        found = true;
        return false;
      }
    });
    if (found) return true;
  }
  return false;
};

const hasInteractiveJsxAncestor = (
  openingElement: EsTreeNodeOfType<"JSXOpeningElement">,
  settings: Readonly<Record<string, unknown>> | undefined,
): boolean => {
  let current = getEnclosingJsxElement(openingElement)?.parent;
  while (current) {
    if (isNodeOfType(current, "JSXElement")) {
      const ancestorTag = getElementType(current.openingElement, settings);
      if (isInteractiveElement(ancestorTag, current.openingElement)) return true;
    }
    current = current.parent;
  }
  return false;
};

// Port of `oxc_linter::rules::jsx_a11y::prefer_tag_over_role`. When a
// generic element (`div`/`span`) uses `role` to emulate a built-in
// element's semantics, suggest using the built-in directly — unless the
// custom element exists precisely because the native tag can't be used
// there (ARIA composite widgets, void tags asked to hold children,
// nested-interactive workarounds).
export const preferTagOverRole = defineRule({
  id: "prefer-tag-over-role",
  title: "Role used instead of HTML tag",
  tags: ["react-jsx-only"],
  severity: "warn",
  recommendation:
    "Use the matching HTML element when one exists so browsers and assistive tech get native semantics.",
  category: "Accessibility",
  create: (context) => {
    const isTestlikeFile = isTestlikeFilename(context.filename);
    return {
      JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
        if (isTestlikeFile) return;
        const tag = getElementType(node, context.settings);
        const isGenericContainer = tag === "div" || tag === "span";
        if (!isGenericContainer && tag !== "a") return;
        const roleAttr = hasJsxPropIgnoreCase(node.attributes, "role");
        if (!roleAttr) return;
        const role = getJsxPropStringValue(roleAttr);
        if (!role) return;
        // An href-less `<a role="button">` is a hand-rolled button (an anchor
        // without href has no link semantics), so the native-`<button>`
        // suggestion applies just like for a div/span. Any other role on an
        // anchor stays out of scope, and a spread could supply `href`.
        if (
          !isGenericContainer &&
          (role !== "button" ||
            hasJsxPropIgnoreCase(node.attributes, "href") ||
            hasJsxSpreadAttribute(node.attributes))
        ) {
          return;
        }
        if (ROLES_WITHOUT_CLEAN_TAG.has(role)) return;
        if (TABLE_STRUCTURE_ROLES.has(role)) return;
        if (
          VALUED_WIDGET_ROLES.has(role) &&
          VALUED_WIDGET_SIGNAL_ATTRIBUTES.some((attribute) =>
            hasJsxPropIgnoreCase(node.attributes, attribute),
          )
        ) {
          return;
        }
        if (isHiddenFromScreenReader(node, context.settings)) return;
        // A contentEditable element is a custom editing surface (rich-text /
        // token editors) that no native form control can replace.
        if (hasJsxPropIgnoreCase(node.attributes, "contenteditable")) return;
        const matchingTags = getTagsForRole(role);
        if (matchingTags.length === 0) return;
        const preferred = PREFERRED_TAG_OVERRIDES[role] ?? matchingTags[0]!;
        const enclosingElement = getEnclosingJsxElement(node);
        if (
          CHILD_REJECTING_TAGS.has(preferred) &&
          enclosingElement &&
          hasMeaningfulChildren(enclosingElement)
        ) {
          return;
        }
        if (preferred === "button" || preferred === "a") {
          if (
            enclosingElement &&
            hasButtonIncompatibleDescendant(enclosingElement, context.settings)
          ) {
            return;
          }
          if (hasInteractiveJsxAncestor(node, context.settings)) return;
        }
        context.report({ node: roleAttr, message: buildMessage(role, preferred) });
      },
    };
  },
});
