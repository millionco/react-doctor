import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { Rule } from "../../utils/rule.js";

const TABLE_ELEMENTS = new Set(["table", "thead", "tbody", "tfoot", "tr", "td", "th"]);

const ROW_GROUPS = new Set(["thead", "tbody", "tfoot"]);

const buildMessage = (childTag: string, expectedParent: string, actualParent: string): string =>
  `Improper table nesting — \`<${childTag}>\` must be a direct child of ${expectedParent}, but its nearest host ancestor is \`<${actualParent}>\`. Browsers auto-rewrite invalid table structure, producing a DOM that doesn't match the JSX (broken hydration, broken \`>\` selectors, broken accessibility tree).`;

const buildNestedTableMessage = (): string =>
  "Improper table nesting — `<table>` cannot be a direct descendant of another table element. Tables can only nest inside a `<td>` cell of an outer table.";

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

// Walks up JSX ancestors and returns the nearest enclosing host (lowercase)
// JSXElement's tag name. Mirrors preact/debug's
// `getClosestDomNodeParentName(parent)`, which walks the VNode tree past
// component VNodes to find the nearest DOM-element ancestor. For static
// analysis the analogous step is "skip user-component JSX elements". The
// walk also bails out (returns null) the moment it crosses a custom
// component — at that point we genuinely can't tell what host element
// will surround the current node at runtime, so the safest move is to
// not flag.
const findClosestHostAncestor = (
  jsxElement: EsTreeNodeOfType<"JSXElement">,
): { tagName: string; element: EsTreeNodeOfType<"JSXElement"> } | "unknown" | null => {
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
          return { tagName: ancestorTag, element: ancestor };
        }
        // Component ancestor — runtime DOM shape is opaque.
        return "unknown";
      }
      // Member-expression / namespace JSX names (`<Foo.Bar>`,
      // `<svg:circle>`) are also opaque.
      return "unknown";
    }
    ancestor = ancestor.parent ?? null;
  }
  return null;
};

const findEnclosingTable = (
  jsxElement: EsTreeNodeOfType<"JSXElement">,
): EsTreeNodeOfType<"JSXElement"> | null => {
  let ancestor: EsTreeNode | null | undefined = jsxElement.parent;
  while (ancestor) {
    if (isNodeOfType(ancestor, "JSXElement")) {
      const tag = getHostTagName(ancestor);
      if (tag === "table") return ancestor;
      if (tag === "td") return null;
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
  severity: "warn",
  recommendation:
    "Wrap each table element in its required parent: `<thead>`/`<tbody>`/`<tfoot>` directly inside `<table>`, `<tr>` inside a row group, `<td>`/`<th>` inside `<tr>`. Browsers reflow malformed table structure silently — the only safe fix is to author the markup to spec.",
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
      // No host ancestor at all (top-level JSX) — preact/debug skips this
      // case explicitly to avoid false positives in partial renders, and
      // the same reasoning applies here: we can't validate a fragment
      // whose runtime parent is supplied by another component.
      if (closestHost === null || closestHost === "unknown") return;
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
