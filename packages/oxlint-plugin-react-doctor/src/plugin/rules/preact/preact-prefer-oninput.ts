import { defineRule } from "../../utils/define-rule.js";
import { findJsxAttribute } from "../../utils/find-jsx-attribute.js";
import { getJsxPropStringValue } from "../../utils/get-jsx-prop-string-value.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { Rule } from "../../utils/rule.js";

const PREFER_ONINPUT_MESSAGE =
  "In Preact core, `onChange` on text-like inputs only fires on blur — use `onInput` for real-time updates. If using `preact/compat`, this is handled automatically.";

// Input types where the native DOM `change` event fires on blur (not on
// every keystroke). Matches the set exempted by preact/compat's
// `onChangeInputType` regex `/fil|che|rad/` — everything NOT matching
// that regex is affected.
const COMPAT_EXEMPT_INPUT_TYPES = new Set(["checkbox", "radio", "file"]);

// Import sources that signal preact/compat is active in this file.
// When compat is in the dependency graph, onChange is automatically
// remapped to onInput for affected elements — no lint needed.
const COMPAT_IMPORT_SOURCES = new Set([
  "preact/compat",
  "react",
  "react-dom",
  "react/jsx-runtime",
  "react/jsx-dev-runtime",
  "react-dom/client",
]);

const fileImportsPreactCompat = (program: EsTreeNodeOfType<"Program">): boolean => {
  for (const statement of program.body) {
    if (!isNodeOfType(statement as EsTreeNode, "ImportDeclaration")) continue;
    const source = (statement as EsTreeNodeOfType<"ImportDeclaration">).source;
    const value =
      source && typeof (source as { value?: unknown }).value === "string"
        ? (source as { value: string }).value
        : null;
    if (!value) continue;
    if (COMPAT_IMPORT_SOURCES.has(value)) return true;
  }
  return false;
};

const isTextLikeInput = (openingElement: EsTreeNodeOfType<"JSXOpeningElement">): boolean => {
  if (!isNodeOfType(openingElement.name, "JSXIdentifier")) return false;
  const tagName = openingElement.name.name;
  if (tagName === "textarea") return true;
  if (tagName !== "input") return false;
  const typeAttribute = findJsxAttribute(openingElement.attributes as EsTreeNode[], "type");
  if (!typeAttribute) return true;
  const typeValue = getJsxPropStringValue(typeAttribute);
  if (typeValue === null) return true;
  return !COMPAT_EXEMPT_INPUT_TYPES.has(typeValue);
};

// In Preact core (without preact/compat), the native DOM `change` event
// on text-like `<input>` and `<textarea>` elements fires only when the
// element loses focus — not on every keystroke. React famously remaps
// `onChange` to the native `input` event for these elements;
// `preact/compat` mirrors that remapping. Pure Preact projects that
// import from `preact` directly must use `onInput` for real-time updates.
//
// This rule only fires when the file does NOT import from `preact/compat`,
// `react`, or `react-dom` — the presence of any compat-layer import
// means the remapping is active and `onChange` works as expected.
export const preactPreferOninput = defineRule<Rule>({
  id: "preact-prefer-oninput",
  requires: ["preact"],
  severity: "warn",
  recommendation:
    "Replace `onChange` with `onInput` on text-like inputs, or use `preact/compat` which remaps `onChange` automatically.",
  create: (context) => {
    let hasCompat = false;

    return {
      Program(node: EsTreeNodeOfType<"Program">) {
        hasCompat = fileImportsPreactCompat(node);
      },
      JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
        if (hasCompat) return;
        if (!isTextLikeInput(node)) return;
        const onChangeAttribute = findJsxAttribute(node.attributes as EsTreeNode[], "onChange");
        if (!onChangeAttribute) return;
        context.report({ node: onChangeAttribute, message: PREFER_ONINPUT_MESSAGE });
      },
    };
  },
});
