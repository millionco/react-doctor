import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { Rule } from "../../utils/rule.js";

const TABLE_ELEMENTS = new Set(["table", "thead", "tbody", "tfoot", "tr", "td", "th"]);

const ROW_GROUPS = new Set(["thead", "tbody", "tfoot"]);

const buildMessage = (childTag: string, expectedParent: string, actualParent: string): string =>
  `Your users see a rearranged table because \`<${childTag}>\` must sit directly inside ${expectedParent}, not \`<${actualParent}>\`, so the browser fixes the markup for you. Put it in the right parent.`;

const buildNestedTableMessage = (): string =>
  "Your users see a broken table because a `<table>` can't sit directly inside another table element. To nest a table, put it inside a `<td>` or `<th>` cell.";

const getHostTagName = (jsxElement: EsTreeNode): string | null => {
  if (!isNodeOfType(jsxElement, "JSXElement")) return null;
  const opening = jsxElement.openingElement;
  if (!isNodeOfType(opening.name, "JSXIdentifier")) return null;
  const tagName = opening.name.name;
  // Capitalised names are user components — opaque to static HTML
  // structural checks, so we can't tell whether `<MyTable>` ultimately
  // renders a `<table>`. Bail out as soon as one shows up in the
  // ancestor chain.
  if (tagName.length === 0 || tagName[0] !== tagName[0].toLowerCase()) return null;
  return tagName;
};

interface HostAncestorFound {
  kind: "host";
  tagName: string;
  element: EsTreeNodeOfType<"JSXElement">;
}
interface HostAncestorOpaque {
  kind: "opaque";
}
interface HostAncestorNone {
  kind: "none";
}
type ClosestHostAncestor = HostAncestorFound | HostAncestorOpaque | HostAncestorNone;

// Walks up JSX ancestors and returns the nearest enclosing host (lowercase)
// JSXElement's tag name. Mirrors preact/debug's
// `getClosestDomNodeParentName(parent)`, which walks the VNode tree past
// component VNodes to find the nearest DOM-element ancestor. For static
// analysis the analogous step is "skip user-component JSX elements". The
// walk also bails out (`{ kind: "opaque" }`) the moment it crosses a
// custom component or a member-expression / namespace JSX name — at that
// point we genuinely can't tell what host element will surround the
// current node at runtime, so the safest move is to not flag.
const findClosestHostAncestor = (
  jsxElement: EsTreeNodeOfType<"JSXElement">,
): ClosestHostAncestor => {
  let ancestor: EsTreeNode | null | undefined = jsxElement.parent;
  while (ancestor) {
    if (isNodeOfType(ancestor, "JSXElement")) {
      const opening = ancestor.openingElement;
      if (isNodeOfType(opening.name, "JSXIdentifier")) {
        const ancestorTag = opening.name.name;
        if (ancestorTag.length === 0) {
          ancestor = ancestor.parent ?? null;
          continue;
        }
        if (ancestorTag[0] === ancestorTag[0].toLowerCase()) {
          return { kind: "host", tagName: ancestorTag, element: ancestor };
        }
        return { kind: "opaque" };
      }
      // Member-expression (`<Foo.Bar>`) / namespace (`<svg:circle>`) names.
      return { kind: "opaque" };
    }
    ancestor = ancestor.parent ?? null;
  }
  return { kind: "none" };
};

// Cells that legally contain a nested `<table>`. Both `<td>` and `<th>`
// are spec-compliant containers for flow content — preact/debug only
// checks `<td>` upstream, but `<th>` cells holding a nested table is
// also valid HTML, and treating only `<td>` as the boundary produces a
// false positive on `<th><table>...</table></th>` shapes (rare but
// real, and Bugbot caught one in review).
const NESTED_TABLE_BOUNDARY_CELLS = new Set(["td", "th"]);

const findEnclosingTable = (
  jsxElement: EsTreeNodeOfType<"JSXElement">,
): EsTreeNodeOfType<"JSXElement"> | null => {
  let ancestor: EsTreeNode | null | undefined = jsxElement.parent;
  while (ancestor) {
    if (isNodeOfType(ancestor, "JSXElement")) {
      const tag = getHostTagName(ancestor);
      if (tag === "table") return ancestor;
      if (tag !== null && NESTED_TABLE_BOUNDARY_CELLS.has(tag)) return null;
      // Walking past a component — runtime structure is opaque, bail.
      if (tag === null) return null;
    }
    ancestor = ancestor.parent ?? null;
  }
  return null;
};

// Mirrors the runtime nesting checks in `preact/debug/src/debug.js`:
//   if (type === 'table' && domParentName !== 'td' && isTableElement(domParentName))
//     console.error('Improper nesting of table. ...');
//   else if ((type === 'thead' || 'tfoot' || 'tbody') && domParentName !== 'table')
//     console.error(...);
//   else if (type === 'tr' && !ROW_GROUPS.has(domParentName))
//     console.error(...);
//   else if ((type === 'td' || 'th') && domParentName !== 'tr')
//     console.error(...);
//
// Each constraint flags an immediate-parent mismatch on a host JSX
// ancestor. Bails out (no diagnostic) the moment the ancestor walk
// crosses a custom component, since the runtime DOM shape under
// `<MyTable>` is genuinely unknown. preact/debug has the same blind
// spot at runtime: it walks the VNode tree, not the DOM, so it can't
// validate boundaries it can't see either.
export const htmlNoInvalidTableNesting = defineRule<Rule>({
  id: "html-no-invalid-table-nesting",
  title: "Invalid table element nesting",
  severity: "warn",
  recommendation:
    "Put each table element in its required parent: `<thead>`/`<tbody>`/`<tfoot>` directly inside `<table>`, `<tr>` inside a row group, `<td>`/`<th>` inside `<tr>`. Browsers quietly fix broken table markup, so write it to spec.",
  create: (context) => ({
    JSXElement(node: EsTreeNodeOfType<"JSXElement">) {
      const tagName = getHostTagName(node);
      if (!tagName || !TABLE_ELEMENTS.has(tagName)) return;

      if (tagName === "table") {
        const enclosingTable = findEnclosingTable(node);
        if (enclosingTable) {
          context.report({ node: node.openingElement.name, message: buildNestedTableMessage() });
        }
        return;
      }

      const closestHost = findClosestHostAncestor(node);
      // No host ancestor (top-level JSX) and opaque ancestors (custom
      // components, member-expression names) both skip — preact/debug
      // does the same to avoid false positives in partial renders /
      // cross-component boundaries. The runtime parent is genuinely
      // unknowable from inside this scope.
      if (closestHost.kind !== "host") return;
      const actualParent = closestHost.tagName;

      if (ROW_GROUPS.has(tagName)) {
        if (actualParent !== "table") {
          context.report({
            node: node.openingElement.name,
            message: buildMessage(tagName, "`<table>`", actualParent),
          });
        }
        return;
      }

      if (tagName === "tr") {
        if (!ROW_GROUPS.has(actualParent) && actualParent !== "table") {
          // preact/debug also accepts a bare `<table><tr>...` (no row
          // group) at runtime because browsers auto-insert `<tbody>`
          // around a stray `<tr>`. The Preact runtime check does NOT
          // permit `<table>` as the direct parent — but the spec and
          // every browser do, so we relax this to match real-world
          // valid markup. Strict preact/debug-parity would only allow
          // row groups; the trade-off is that a literal
          // `<table><tr></tr></table>` would otherwise warn even
          // though it renders correctly.
          context.report({
            node: node.openingElement.name,
            message: buildMessage(tagName, "`<thead>`, `<tbody>`, or `<tfoot>`", actualParent),
          });
        }
        return;
      }

      if (tagName === "td" || tagName === "th") {
        if (actualParent !== "tr") {
          context.report({
            node: node.openingElement.name,
            message: buildMessage(tagName, "`<tr>`", actualParent),
          });
        }
      }
    },
  }),
});
