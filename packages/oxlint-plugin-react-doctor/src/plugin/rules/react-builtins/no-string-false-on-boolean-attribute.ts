import { defineRule } from "../../utils/define-rule.js";
import { getJsxPropStringValue } from "../../utils/get-jsx-prop-string-value.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

// True HTML boolean attributes: presence means "on", absence means "off".
// Deliberately EXCLUDES enumerated attributes that legitimately take the
// string "false" — `contentEditable`, `draggable`, `spellCheck`, `aria-*`,
// `translate`, `autoComplete` — and `hidden` (now also enumerable as
// `hidden="until-found"`).
const BOOLEAN_ATTRIBUTES = new Set([
  "disabled",
  "checked",
  "readonly",
  "required",
  "selected",
  "multiple",
  "autofocus",
  "autoplay",
  "controls",
  "loop",
  "muted",
  "open",
  "reversed",
  "default",
  "novalidate",
  "formnovalidate",
  "playsinline",
  "itemscope",
  "allowfullscreen",
]);

export const noStringFalseOnBooleanAttribute = defineRule({
  id: "no-string-false-on-boolean-attribute",
  title: "String true/false on a boolean attribute",
  severity: "warn",
  recommendation:
    'Use the boolean form on boolean attributes: `disabled` / `disabled={true}` / `disabled={false}` — not `disabled="false"`. A non-empty string is truthy, so `="false"` actually turns the attribute ON.',
  create: (context) => ({
    JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
      // Only intrinsic elements — a JSXIdentifier starting with a lowercase
      // ASCII letter (a-z). Custom components start uppercase and own their
      // prop semantics (`<Foo disabled="false">` may take a real string).
      if (!isNodeOfType(node.name, "JSXIdentifier")) return;
      const firstCharacter = node.name.name.charCodeAt(0);
      if (firstCharacter < 97 || firstCharacter > 122) return;

      for (const attribute of node.attributes) {
        if (!isNodeOfType(attribute, "JSXAttribute")) continue;
        if (!isNodeOfType(attribute.name, "JSXIdentifier")) continue;
        if (!BOOLEAN_ATTRIBUTES.has(attribute.name.name.toLowerCase())) continue;

        const value = getJsxPropStringValue(attribute);
        if (value !== "false" && value !== "true") continue;

        context.report({
          node: attribute,
          message: `\`${attribute.name.name}="${value}"\` passes the string "${value}", which React treats as truthy — the attribute is applied even when you wrote "false". Use \`${attribute.name.name}\` or \`${attribute.name.name}={${value}}\`.`,
        });
      }
    },
  }),
});
