import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getElementType } from "../../utils/get-element-type.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { getJsxPropStringValue } from "../../utils/get-jsx-prop-string-value.js";
import { hasJsxPropIgnoreCase } from "../../utils/has-jsx-prop-ignore-case.js";
import { getElementImplicitRoles } from "../../constants/aria-element-roles.js";
import { getImplicitRole } from "../../utils/get-implicit-role.js";

interface NoRedundantRolesSettings {
  // Per-element overrides: a tag can specify additional non-redundant
  // roles (e.g. `nav: ["navigation"]` flags `<nav role="navigation">`).
  // The OXC port supports user-provided overrides.
  exceptions?: Readonly<Record<string, ReadonlyArray<string>>>;
}

const buildMessage = (tag: string, role: string): string =>
  `Screen reader users gain nothing from this \`role\` because \`<${tag}>\` already acts as a \`${role}\`, so remove it.`;

// `<ul role="list">` / `<ol role="list">` is the deliberate Safari +
// VoiceOver workaround: `list-style: none` makes WebKit silently drop list
// semantics, and the explicit role restores them. It is an intentional
// a11y-preserving idiom, not redundant noise, so it is exempt by default
// (users can still narrow further via the `exceptions` setting).
const DEFAULT_NON_REDUNDANT_ROLES: Readonly<Record<string, ReadonlyArray<string>>> = {
  ul: ["list"],
  ol: ["list"],
};

// Tags whose implicit role depends on an attribute the static table can't
// see: a bare `<a>`/`<area>`/`<link>` (no `href`) has NO implicit role, so
// `role="link"` on it is a correct addition, not redundant. Resolve these
// through the attribute-aware `getImplicitRole` (as `input` already is)
// instead of the context-free static table.
const ATTRIBUTE_DEPENDENT_IMPLICIT_ROLE_TAGS: ReadonlySet<string> = new Set([
  "input",
  "a",
  "area",
  "link",
]);

// `<td>`/`<th>` each carry several implicit roles in the static table
// (`td` → cell + gridcell; `th` → columnheader + rowheader + gridcell),
// but only ONE is the element's effective default in plain document
// markup: `<td>` is `cell`, and `<th>` is `rowheader` when scoped to a
// row, otherwise `columnheader`. The W3C grid-pattern roles (`gridcell`,
// and the non-default header role) are a deliberate clarification inside
// an ARIA grid, not redundant noise, so only the primary default is
// treated as redundant here.
const getTableCellPrimaryRole = (
  node: EsTreeNodeOfType<"JSXOpeningElement">,
  tag: string,
): string => {
  if (tag === "td") return "cell";
  const scopeAttribute = hasJsxPropIgnoreCase(node.attributes, "scope");
  const scope = scopeAttribute ? getJsxPropStringValue(scopeAttribute)?.toLowerCase() : null;
  return scope === "row" || scope === "rowgroup" ? "rowheader" : "columnheader";
};

// A `<td>`/`<th>` only carries its document-default role (`cell` /
// `columnheader` / `rowheader`) inside a plain `<table>`. Inside a
// `role="grid"`/`"treegrid"` context the implicit role becomes `gridcell`,
// making an explicit `role="cell"` a deliberate override. The enclosing table
// is often in another file (a Cell component rendering a bare `<td>`), so the
// default is only provably redundant when a same-file ancestor establishes a
// plain-table context.
type TableContext = "table" | "grid" | "unknown" | "none";

const findSameFileTableContext = (
  node: EsTreeNodeOfType<"JSXOpeningElement">,
  settings: Readonly<Record<string, unknown>> | undefined,
): TableContext => {
  let current = (node as EsTreeNode).parent;
  while (current) {
    if (isNodeOfType(current, "JSXElement")) {
      const opening = current.openingElement as EsTreeNodeOfType<"JSXOpeningElement">;
      const ancestorRoleAttr = hasJsxPropIgnoreCase(opening.attributes, "role");
      const ancestorRole = ancestorRoleAttr ? getJsxPropStringValue(ancestorRoleAttr) : null;
      if (ancestorRole === "grid" || ancestorRole === "treegrid") return "grid";
      if (ancestorRole === "table") return "table";
      if (getElementType(opening, settings) === "table") {
        return ancestorRoleAttr ? "unknown" : "table";
      }
    }
    current = current.parent ?? null;
  }
  return "none";
};

const resolveSettings = (
  settings: Readonly<Record<string, unknown>> | undefined,
): Required<NoRedundantRolesSettings> => {
  const reactDoctor = settings?.["react-doctor"];
  const ruleSettings =
    typeof reactDoctor === "object" && reactDoctor !== null
      ? ((reactDoctor as { noRedundantRoles?: NoRedundantRolesSettings }).noRedundantRoles ?? {})
      : {};
  return { exceptions: ruleSettings.exceptions ?? {} };
};

// Port of `oxc_linter::rules::jsx_a11y::no_redundant_roles`. Reports a
// `role` attribute that matches the element's implicit role.
export const noRedundantRoles = defineRule({
  id: "no-redundant-roles",
  title: "Redundant ARIA role",
  tags: ["react-jsx-only"],
  severity: "warn",
  recommendation:
    "Remove redundant `role` attributes so assistive tech reads the element's native semantics without extra noise.",
  category: "Accessibility",
  create: (context) => {
    const settings = resolveSettings(context.settings);
    return {
      JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
        const roleAttr = hasJsxPropIgnoreCase(node.attributes, "role");
        if (!roleAttr) return;
        // react-aria's table pattern (marked by `data-rac`) re-applies
        // explicit roles because CSS-restyled tables lose implicit semantics
        // in some ATs — the doc's carve-out for roles kept to work around AT
        // misreporting.
        if (hasJsxPropIgnoreCase(node.attributes, "data-rac")) return;
        const role = getJsxPropStringValue(roleAttr);
        if (role === null) return;
        const tag = getElementType(node, context.settings);
        // The static table lists every role a tag *can* take, but
        // attribute-dependent tags have exactly ONE effective role given
        // their attributes (e.g. `<input type="text">` → textbox, bare
        // `<a>` → none). Treating the full set as redundant mislabels
        // `<input type="text" role="combobox">` (an upgrade) and
        // `<a role="link">` without `href` (no implicit role at all).
        let implicitRoles: ReadonlyArray<string>;
        if (tag === "td" || tag === "th") {
          if (findSameFileTableContext(node, context.settings) !== "table") return;
          implicitRoles = [getTableCellPrimaryRole(node, tag)];
        } else if (ATTRIBUTE_DEPENDENT_IMPLICIT_ROLE_TAGS.has(tag)) {
          implicitRoles = [getImplicitRole(node, tag, context.scopes)].filter(
            (resolvedRole): resolvedRole is string => resolvedRole !== null,
          );
        } else {
          implicitRoles = getElementImplicitRoles(tag);
        }
        const allowedHere = [
          ...(DEFAULT_NON_REDUNDANT_ROLES[tag] ?? []),
          ...(settings.exceptions[tag] ?? []),
        ];
        if (implicitRoles.includes(role) && !allowedHere.includes(role)) {
          context.report({ node: roleAttr, message: buildMessage(tag, role) });
        }
      },
    };
  },
});
