import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { extractStaticStringValue } from "../../utils/extract-static-string-value.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";

// HACK: Mirrors the WHATWG URL parser's pre-scheme step — strip C0
// controls first, then match scheme — because embedding the C0 range
// directly in a regex literal trips `no-control-regex`.
const JAVASCRIPT_SCHEME_PATTERN = /^ *javascript:/i;

const isUrlControlCharacterCode = (characterCode: number): boolean =>
  characterCode >= 0 && characterCode <= 0x1f;

const stripUrlControlCharacters = (urlValue: string): string => {
  let stripped = "";
  for (const character of urlValue) {
    if (!isUrlControlCharacterCode(character.charCodeAt(0))) stripped += character;
  }
  return stripped;
};

const startsWithJavascriptScheme = (urlValue: string): boolean =>
  JAVASCRIPT_SCHEME_PATTERN.test(stripUrlControlCharacters(urlValue));

// Port of `solid/jsx-no-script-url` — flags `<a href="javascript:...">`
// and similar `javascript:` URLs in JSX attributes. Adapted from
// `eslint-plugin-react`'s rule of the same name.
export const solidJsxNoScriptUrl = defineRule<Rule>({
  id: "solid-jsx-no-script-url",
  severity: "error",
  requires: ["solid"],
  recommendation: "Use an event handler instead of a `javascript:` URL — they're a security risk.",
  create: (context: RuleContext) => ({
    JSXAttribute(node: EsTreeNodeOfType<"JSXAttribute">) {
      if (!isNodeOfType(node.name, "JSXIdentifier")) return;
      if (!node.value) return;
      const expression = isNodeOfType(node.value, "JSXExpressionContainer")
        ? (node.value.expression as EsTreeNode)
        : (node.value as EsTreeNode);
      const stringValue = extractStaticStringValue(expression);
      if (stringValue && startsWithJavascriptScheme(stringValue)) {
        context.report({
          node: node.value,
          message: "For security, don't use `javascript:` URLs. Use event handlers instead.",
        });
      }
    },
  }),
});
