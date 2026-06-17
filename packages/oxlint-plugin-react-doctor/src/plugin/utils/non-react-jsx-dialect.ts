import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { isNodeOfType } from "./is-node-of-type.js";

// Non-React JSX dialects that use raw HTML attribute names (`class`,
// `for`, `tabindex`, etc.) and have their own a11y / keyboard /
// interaction semantics. React-doctor's React-flavoured rules
// (`no-unknown-property`, a11y rules expecting React-style listeners,
// etc.) should pass through for these files — they're not React.
// Detected by:
//   1. an import from the dialect's runtime package, OR
//   2. distinctively-Solid syntax in the file (`classList={...}`,
//      which only Solid's JSX recognises)
const NON_REACT_JSX_DIALECT_PACKAGES: ReadonlySet<string> = new Set([
  "solid-js",
  "solid-js/web",
  "solid-js/store",
  "solid-js/h",
  "solid-js/html",
  "@builder.io/qwik",
  "@builder.io/qwik-city",
  "@builder.io/qwik-react",
  "voby",
  "vidode",
]);

const NON_REACT_JSX_DIALECT_PACKAGE_PREFIXES: ReadonlyArray<string> = [
  "solid-js",
  "@builder.io/qwik",
];

const startsWithAny = (source: string, prefixes: ReadonlyArray<string>): boolean =>
  prefixes.some((prefix) => source === prefix || source.startsWith(`${prefix}/`));

export const fileImportsNonReactJsxDialect = (program: EsTreeNodeOfType<"Program">): boolean => {
  for (const statement of program.body) {
    if (!isNodeOfType(statement as EsTreeNode, "ImportDeclaration")) continue;
    const source = (statement as EsTreeNodeOfType<"ImportDeclaration">).source;
    const value =
      source && typeof (source as { value?: unknown }).value === "string"
        ? (source as { value: string }).value
        : null;
    if (!value) continue;
    if (NON_REACT_JSX_DIALECT_PACKAGES.has(value)) return true;
    if (startsWithAny(value, NON_REACT_JSX_DIALECT_PACKAGE_PREFIXES)) return true;
  }
  return false;
};

// `classList={...}` is Solid-distinctive — React JSX would write
// `className={cn(...)}` or pass an object to a `clsx` call. Used as a
// fallback signal when a file uses Solid JSX without importing solid-js
// directly (e.g. relies on transitive imports via `*.tsx` only).
export const jsxAttributeIsNonReactDialectMarker = (
  openingNode: EsTreeNodeOfType<"JSXOpeningElement">,
): boolean => {
  for (const attribute of openingNode.attributes) {
    if (!isNodeOfType(attribute, "JSXAttribute")) continue;
    if (!isNodeOfType(attribute.name, "JSXIdentifier")) continue;
    // `classList` (Solid), `class:hover` (svelte-jsx style — rare in
    // React), `bind:value` (svelte) — collectively non-React markers.
    if (attribute.name.name === "classList") return true;
    if (attribute.name.name.startsWith("class:") || attribute.name.name.startsWith("bind:")) {
      return true;
    }
  }
  return false;
};
