import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { getJsxPropStringValue } from "./get-jsx-prop-string-value.js";
import { hasJsxPropIgnoreCase } from "./has-jsx-prop-ignore-case.js";
import { resolveJsxElementType } from "./resolve-jsx-element-type.js";

interface JsxA11ySettings {
  components?: Readonly<Record<string, string>>;
  polymorphicPropName?: string;
}

interface ElementTypeCacheEntry {
  settings: Readonly<Record<string, unknown>> | undefined;
  elementType: string;
}

const EMPTY_JSX_A11Y_SETTINGS: JsxA11ySettings = Object.freeze({});

const jsxA11ySettingsCache = new WeakMap<Readonly<Record<string, unknown>>, JsxA11ySettings>();

const readJsxA11ySettings = (
  settings: Readonly<Record<string, unknown>> | undefined,
): JsxA11ySettings => {
  if (!settings) return EMPTY_JSX_A11Y_SETTINGS;
  const cachedSettings = jsxA11ySettingsCache.get(settings);
  if (cachedSettings) return cachedSettings;
  const block = (settings as { ["jsx-a11y"]?: JsxA11ySettings })["jsx-a11y"];
  const a11ySettings = block && typeof block === "object" ? block : EMPTY_JSX_A11Y_SETTINGS;
  jsxA11ySettingsCache.set(settings, a11ySettings);
  return a11ySettings;
};

const computeElementType = (
  openingElement: EsTreeNodeOfType<"JSXOpeningElement">,
  a11ySettings: JsxA11ySettings,
): string => {
  const baseName = resolveJsxElementType(openingElement);

  if (a11ySettings.polymorphicPropName) {
    const polymorphicAttribute = hasJsxPropIgnoreCase(
      openingElement.attributes,
      a11ySettings.polymorphicPropName,
    );
    if (polymorphicAttribute) {
      const polymorphicValue = getJsxPropStringValue(polymorphicAttribute);
      if (polymorphicValue !== null) return polymorphicValue;
    }
  }

  if (a11ySettings.components && baseName in a11ySettings.components) {
    return a11ySettings.components[baseName]!;
  }
  return baseName;
};

// Per-node memo shared by the ~30 a11y rules that resolve the same opening
// element once per rule. Entries die with the AST via the WeakMap. The result
// also depends on settings, so each entry carries a settings-identity guard:
// both hosts hand every rule the same per-file settings object (oxlint parses
// the settings JSON once per file and exposes it through the shared
// FILE_CONTEXT prototype getter; ESLint 9 puts config.settings on the one
// FileContext all rule contexts inherit from), so within a file the guard
// always matches after the first rule computes it, and a different settings
// object (next file, tests) recomputes instead of serving a stale entry.
const elementTypeCache = new WeakMap<
  EsTreeNodeOfType<"JSXOpeningElement">,
  ElementTypeCacheEntry
>();

// Resolves a JSX opening element to the (possibly-aliased) HTML tag
// name. Mirrors oxc_linter::utils::react::get_element_type.
//
// - Honors `settings["jsx-a11y"].polymorphicPropName` (defaults to
//   none): when the element has that prop with a string-literal
//   value, the value overrides the element's tag.
// - Honors `settings["jsx-a11y"].components`: a mapping from
//   component name → resolved tag (e.g. `{ Button: "button" }`).
// - Falls back to the JSX identifier / member-expression name.
export const getElementType = (
  openingElement: EsTreeNodeOfType<"JSXOpeningElement">,
  settings: Readonly<Record<string, unknown>> | undefined,
): string => {
  const cachedEntry = elementTypeCache.get(openingElement);
  if (cachedEntry && cachedEntry.settings === settings) return cachedEntry.elementType;
  const elementType = computeElementType(openingElement, readJsxA11ySettings(settings));
  elementTypeCache.set(openingElement, { settings, elementType });
  return elementType;
};
