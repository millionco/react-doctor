import { isValidDomAriaProperty } from "../../constants/dom-aria-properties.js";
import {
  DOM_ATTRIBUTES_TO_CAMEL,
  DOM_PROPERTIES_IGNORE_CASE_BY_LOWER,
  DOM_PROPERTY_NAMES,
  DOM_PROPERTY_NAMES_LOWER,
} from "../../constants/dom-property-names.js";
import { DOM_PROPERTY_TO_ALLOWED_TAGS } from "../../constants/dom-property-tags.js";
import { HTML_TAGS } from "../../constants/html-tags.js";
import { SVG_TAGS } from "../../constants/svg-tags.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getJsxAttributeName } from "../../utils/get-jsx-attribute-name.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { fileImportsNonReactJsxDialect } from "../../utils/non-react-jsx-dialect.js";
import { resolveJsxElementType } from "../../utils/resolve-jsx-element-type.js";

interface NoUnknownPropertySettings {
  ignore?: ReadonlyArray<string>;
  requireDataLowercase?: boolean;
}

const resolveSettings = (
  settings: Readonly<Record<string, unknown>> | undefined,
): NoUnknownPropertySettings => {
  const reactDoctor = settings?.["react-doctor"];
  if (typeof reactDoctor !== "object" || reactDoctor === null) return {};
  return (reactDoctor as { noUnknownProperty?: NoUnknownPropertySettings }).noUnknownProperty ?? {};
};

// Mirrors the Rust `is_valid_data_attr` predicate: starts with `data-`,
// not `data-xml*`, has a non-empty name segment, and contains no `:`.
const isValidDataAttribute = (attributeName: string): boolean => {
  if (!attributeName.startsWith("data-")) return false;
  if (attributeName.toLowerCase().startsWith("data-xml")) return false;
  const dataName = attributeName.slice("data-".length);
  if (dataName.length === 0) return false;
  return !dataName.includes(":");
};

// Only real HTML/SVG/MathML elements go through DOM-property validation.
// Lowercase JSX intrinsics from custom reconcilers (react-three-fiber
// `<mesh>`, `<meshStandardMaterial>`, Electron `<webview>`, …) accept
// arbitrary props that React never sees as DOM attributes.
const isKnownDomTag = (tagName: string): boolean => HTML_TAGS.has(tagName) || SVG_TAGS.has(tagName);

// React attaches synthetic events (`onLoad`, `onError`, media events, …)
// to any host element, so per-tag restrictions never apply to handlers.
const isSyntheticEventHandlerName = (propertyName: string): boolean =>
  /^on[A-Z]/.test(propertyName);

const normalizeAttributeCase = (name: string): string =>
  DOM_PROPERTIES_IGNORE_CASE_BY_LOWER.get(name.toLowerCase()) ?? name;

const hasUppercaseChar = (input: string): boolean => /[A-Z]/.test(input);

const INVALID_PROP_ON_TAG = (propName: string, allowedTags: string): string =>
  `React ignores \`${propName}\` here because it only works on these tags: ${allowedTags}.`;
const DATA_LOWERCASE_REQUIRED = (): string =>
  `React drops this \`data-*\` prop because of its capital letters.`;
const UNKNOWN_PROP_WITH_STANDARD_NAME = (): string =>
  `React ignores this prop because it doesn't recognize the name.`;
const UNKNOWN_PROP_GENERIC = "React ignores this prop because it doesn't recognize the name.";

// Port of `oxc_linter::rules::react::no_unknown_property`, narrowed to
// fire only when React genuinely drops or renames the prop:
//   - `aria-*` must be a valid ARIA property name.
//   - `data-*` must follow the kebab-case lowercase convention; with
//     `requireDataLowercase` setting, uppercase chars are also flagged.
//   - Unknown attrs on a known HTML/SVG tag are flagged when the
//     lowercase form maps back to a known camelCase name (`onclick` →
//     `onClick`, `class` → `className`) or when the name contains
//     uppercase chars React would warn about and lowercase. All-lowercase
//     names with no known camel form (`<div frimousse-list>`) render to
//     the DOM verbatim since React 16 and are never reported.
//   - Tag-restricted non-event attrs (`fetchPriority`, `viewBox`,
//     `download`, …) are flagged on tags outside their allowed set;
//     event handlers (`onLoad`, `onError`, media events) attach anywhere
//     via React's synthetic event system and are never tag-restricted.
// Custom elements (`<my-elem>`, anything with `is="..."`) and lowercase
// intrinsics that aren't real HTML/SVG tags (react-three-fiber `<mesh>`,
// Electron `<webview>`) are skipped.
// Non-React JSX dialect detection — see
// `utils/non-react-jsx-dialect.ts` for the canonical package list +
// the import / attribute markers we recognise.

export const noUnknownProperty = defineRule({
  id: "no-unknown-property",
  title: "Unknown DOM property",
  severity: "warn",
  recommendation:
    "Use the prop name React expects, like `className`, `htmlFor`, or `tabIndex`, so the attribute is applied correctly.",
  create: (context) => {
    const { ignore = [], requireDataLowercase = false } = resolveSettings(context.settings);
    const ignoreSet = new Set(ignore);
    let fileIsNonReactJsx = false;

    return {
      Program(node: EsTreeNodeOfType<"Program">) {
        fileIsNonReactJsx = fileImportsNonReactJsxDialect(node);
      },
      JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
        // Solid-distinctive `classList={{…}}` attribute — only the
        // object-value shape (`classList={{foo: true}}`) is unique to
        // Solid. A plain `classList={...}` in a React file is just a
        // user mistake we should still flag as an unknown prop, so we
        // require the ObjectExpression form before promoting the entire
        // file to a non-React dialect.
        if (!fileIsNonReactJsx) {
          for (const attribute of node.attributes) {
            if (!isNodeOfType(attribute, "JSXAttribute")) continue;
            if (!isNodeOfType(attribute.name, "JSXIdentifier")) continue;
            if (attribute.name.name !== "classList") continue;
            const value = attribute.value;
            if (!isNodeOfType(value, "JSXExpressionContainer")) continue;
            if (!isNodeOfType(value.expression, "ObjectExpression")) continue;
            fileIsNonReactJsx = true;
            break;
          }
        }
        if (fileIsNonReactJsx) return;
        if (!isNodeOfType(node.name, "JSXIdentifier")) return;
        const elementType = resolveJsxElementType(node);
        const firstCharacter = elementType.charCodeAt(0);
        const isLowercaseStart = firstCharacter >= 97 && firstCharacter <= 122;
        if (!isLowercaseStart || elementType === "fbt" || elementType === "fbs") return;

        let isValidHtmlTag = isKnownDomTag(elementType);
        if (isValidHtmlTag) {
          for (const attribute of node.attributes) {
            if (!isNodeOfType(attribute, "JSXAttribute")) continue;
            if (!isNodeOfType(attribute.name, "JSXIdentifier")) continue;
            if (attribute.name.name === "is") {
              isValidHtmlTag = false;
              break;
            }
          }
        }

        for (const attribute of node.attributes) {
          if (!isNodeOfType(attribute, "JSXAttribute")) continue;
          const actualName = getJsxAttributeName(attribute.name);
          if (!actualName) continue;
          if (ignoreSet.has(actualName)) continue;

          if (isValidDataAttribute(actualName)) {
            if (requireDataLowercase && hasUppercaseChar(actualName)) {
              context.report({
                node: attribute.name,
                message: DATA_LOWERCASE_REQUIRED(),
              });
            }
            continue;
          }

          if (isValidDomAriaProperty(actualName)) continue;
          if (!isValidHtmlTag) continue;

          const normalizedName = normalizeAttributeCase(actualName);
          const allowedTags = DOM_PROPERTY_TO_ALLOWED_TAGS.get(normalizedName);
          if (allowedTags) {
            if (isSyntheticEventHandlerName(normalizedName)) continue;
            if (!allowedTags.has(elementType)) {
              context.report({
                node: attribute.name,
                message: INVALID_PROP_ON_TAG(actualName, [...allowedTags].join(", ")),
              });
            }
            continue;
          }

          if (DOM_PROPERTY_NAMES.has(normalizedName)) continue;

          // Hyphenated SVG presentation attributes (`stroke-width`,
          // `clip-rule`, `fill-opacity`, …) on SVG elements are the real
          // attribute names — React sets unknown lowercase attributes via
          // `setAttribute`, so they render correctly and "React ignores
          // this prop" would be false. Renaming to the camelCase form is
          // purely stylistic; stay silent on SVG hosts.
          if (
            SVG_TAGS.has(elementType) &&
            actualName.includes("-") &&
            !hasUppercaseChar(actualName) &&
            DOM_ATTRIBUTES_TO_CAMEL.has(actualName)
          ) {
            continue;
          }

          const lowercased = normalizedName.toLowerCase();
          const suggestion =
            DOM_PROPERTY_NAMES_LOWER.get(lowercased) ?? DOM_ATTRIBUTES_TO_CAMEL.get(normalizedName);
          if (suggestion) {
            context.report({
              node: attribute.name,
              message: UNKNOWN_PROP_WITH_STANDARD_NAME(),
            });
            continue;
          }

          // Since React 16, unknown all-lowercase attributes are rendered
          // to the DOM verbatim (`<div frimousse-list>`, `<iframe
          // credentialless>`), so "React ignores this prop" would be
          // false. Only malformed `aria-*` / `data-*` names and
          // uppercase-containing props (which React warns about and
          // lowercases) are genuine mistakes worth reporting.
          const isRenderedVerbatimByReact =
            !hasUppercaseChar(actualName) &&
            !actualName.startsWith("aria-") &&
            !actualName.startsWith("data-");
          if (isRenderedVerbatimByReact) continue;

          context.report({ node: attribute.name, message: UNKNOWN_PROP_GENERIC });
        }
      },
    };
  },
});
