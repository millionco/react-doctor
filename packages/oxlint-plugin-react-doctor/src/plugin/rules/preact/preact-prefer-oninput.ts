import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findJsxAttribute } from "../../utils/find-jsx-attribute.js";
import { getJsxPropStringValue } from "../../utils/get-jsx-prop-string-value.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { Rule } from "../../utils/rule.js";

const PREFER_ONINPUT_MESSAGE =
  "Your users see no live updates because `onChange` on text inputs in Preact core only fires on blur, so use `onInput` instead. `preact/compat` handles this for you.";

// Input types where the native DOM `change` event fires on blur (not on
// every keystroke). Matches the set exempted by preact/compat's
// `onChangeInputType` regex `/fil|che|rad/` — everything NOT matching
// that regex is affected.
const COMPAT_EXEMPT_INPUT_TYPES = new Set(["checkbox", "radio", "file"]);

const isTextLikeInput = (openingElement: EsTreeNodeOfType<"JSXOpeningElement">): boolean => {
  if (!isNodeOfType(openingElement.name, "JSXIdentifier")) return false;
  const tagName = openingElement.name.name;
  if (tagName === "textarea") return true;
  if (tagName !== "input") return false;
  const typeAttribute = findJsxAttribute(openingElement.attributes, "type");
  if (!typeAttribute) return true;
  const typeValue = getJsxPropStringValue(typeAttribute);
  if (typeValue === null) return true;
  return !COMPAT_EXEMPT_INPUT_TYPES.has(typeValue);
};

// In Preact core (without preact/compat), the native DOM `change` event
// on text-like `<input>` and `<textarea>` elements fires only when the
// element loses focus — not on every keystroke. React famously remaps
// `onChange` to the native `input` event for these elements;
// `preact/compat` mirrors that remapping at the *renderer* level.
//
// Gated on `pure-preact` (Preact in deps AND no `react` package). The
// previous version did per-file compat detection by scanning each
// file's imports for `preact/compat` / `react` / `react-dom`, but
// preact/compat's onChange remap is a runtime patch on the Preact
// renderer — once compat is loaded anywhere in the project, every
// component benefits from the remapping regardless of its own import
// list. Per-file detection therefore false-positived on files that
// only imported from `preact/hooks`. Project-level scoping via
// `pure-preact` is both simpler and correct: if `react` (the alias
// entry point for compat) is present in deps, the rule sits out
// entirely. Pairs with the sibling `preact-prefer-ondblclick` rule.
export const preactPreferOninput = defineRule<Rule>({
  id: "preact-prefer-oninput",
  title: "onChange instead of onInput",
  requires: ["pure-preact"],
  severity: "warn",
  recommendation:
    "Replace `onChange` with `onInput` on text-like inputs, or use `preact/compat` which remaps `onChange` automatically.",
  create: (context) => ({
    JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
      if (!isTextLikeInput(node)) return;
      const onChangeAttribute = findJsxAttribute(node.attributes, "onChange");
      if (!onChangeAttribute) return;
      context.report({ node: onChangeAttribute, message: PREFER_ONINPUT_MESSAGE });
    },
  }),
});
