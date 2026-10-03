import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { getImportedName } from "./get-imported-name.js";
import { getJsxAttributeName } from "./get-jsx-attribute-name.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isTypeOnlyImport } from "./is-type-only-import.js";
import { walkAst } from "./walk-ast.js";

export interface JsxRuntimeImports {
  readonly hasNonReactMarker: boolean;
  readonly hasNonReactRuntime: boolean;
  readonly hasReactRuntime: boolean;
}

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

const REACT_JSX_DIALECT_PACKAGE_PREFIXES: ReadonlyArray<string> = ["react", "react-dom", "preact"];
const runtimeImportsByProgram = new WeakMap<EsTreeNodeOfType<"Program">, JsxRuntimeImports>();
const nonReactDialectMarkerByOpeningElement = new WeakMap<
  EsTreeNodeOfType<"JSXOpeningElement">,
  boolean
>();

const startsWithAny = (source: string, prefixes: ReadonlyArray<string>): boolean =>
  prefixes.some((prefix) => source === prefix || source.startsWith(`${prefix}/`));

export const collectJsxRuntimeImports = (
  program: EsTreeNodeOfType<"Program">,
): JsxRuntimeImports => {
  const cachedRuntimeImports = runtimeImportsByProgram.get(program);
  if (cachedRuntimeImports) return cachedRuntimeImports;

  let hasNonReactRuntime = false;
  let hasReactRuntime = false;
  let hasNonReactMarker = false;
  let hasSolidComponentType = false;
  let hasSolidJsxType = false;
  let hasNativeClassAttribute = false;
  for (const statement of program.body) {
    if (!hasNonReactMarker) {
      walkAst(statement as EsTreeNode, (node) => {
        if (hasNonReactMarker) return false;
        if (isNodeOfType(node, "JSXOpeningElement") && jsxAttributeIsNonReactDialectMarker(node)) {
          hasNonReactMarker = true;
          return false;
        }
        if (
          isNodeOfType(node, "JSXOpeningElement") &&
          isNodeOfType(node.name, "JSXIdentifier") &&
          /^[a-z]/.test(node.name.name) &&
          node.attributes.some(
            (attribute) =>
              isNodeOfType(attribute, "JSXAttribute") &&
              getJsxAttributeName(attribute.name) === "class",
          )
        ) {
          hasNativeClassAttribute = true;
        }
      });
    }
    if (!isNodeOfType(statement as EsTreeNode, "ImportDeclaration")) continue;
    const importDeclaration = statement as EsTreeNodeOfType<"ImportDeclaration">;
    const source = importDeclaration.source;
    const value =
      source && typeof (source as { value?: unknown }).value === "string"
        ? (source as { value: string }).value
        : null;
    if (!value) continue;
    if (value === "solid-js") {
      for (const specifier of importDeclaration.specifiers) {
        if (!isNodeOfType(specifier, "ImportSpecifier")) continue;
        if (importDeclaration.importKind !== "type" && specifier.importKind !== "type") continue;
        const importedName = getImportedName(specifier);
        if (importedName === "Component") hasSolidComponentType = true;
        if (importedName === "JSX") hasSolidJsxType = true;
      }
    }
    if (isTypeOnlyImport(importDeclaration)) continue;
    if (
      NON_REACT_JSX_DIALECT_PACKAGES.has(value) ||
      startsWithAny(value, NON_REACT_JSX_DIALECT_PACKAGE_PREFIXES)
    ) {
      hasNonReactRuntime = true;
    }
    if (startsWithAny(value, REACT_JSX_DIALECT_PACKAGE_PREFIXES)) {
      hasReactRuntime = true;
    }
  }
  const runtimeImports = {
    hasNonReactMarker:
      hasNonReactMarker || hasSolidComponentType || (hasSolidJsxType && hasNativeClassAttribute),
    hasNonReactRuntime,
    hasReactRuntime,
  };
  runtimeImportsByProgram.set(program, runtimeImports);
  return runtimeImports;
};

// `classList={...}` is Solid-distinctive — React JSX would write
// `className={cn(...)}` or pass an object to a `clsx` call. Used as a
// fallback signal when a file uses Solid JSX without importing solid-js
// directly (e.g. relies on transitive imports via `*.tsx` only).
export const jsxAttributeIsNonReactDialectMarker = (
  openingNode: EsTreeNodeOfType<"JSXOpeningElement">,
): boolean => {
  const cachedMarker = nonReactDialectMarkerByOpeningElement.get(openingNode);
  if (cachedMarker !== undefined) return cachedMarker;
  let isNonReactDialectMarker = false;
  for (const attribute of openingNode.attributes) {
    if (!isNodeOfType(attribute, "JSXAttribute")) continue;
    const attributeName = getJsxAttributeName(attribute.name);
    if (!attributeName) continue;
    const isObjectClassList =
      attributeName === "classList" &&
      isNodeOfType(attribute.value, "JSXExpressionContainer") &&
      isNodeOfType(attribute.value.expression, "ObjectExpression");
    if (
      isObjectClassList ||
      (isNodeOfType(openingNode.name, "JSXIdentifier") &&
        /^[a-z]/.test(openingNode.name.name) &&
        (attributeName.startsWith("class:") ||
          attributeName.startsWith("bind:") ||
          attributeName.startsWith("on:") ||
          attributeName.startsWith("oncapture:")))
    ) {
      isNonReactDialectMarker = true;
      break;
    }
  }
  nonReactDialectMarkerByOpeningElement.set(openingNode, isNonReactDialectMarker);
  return isNonReactDialectMarker;
};
