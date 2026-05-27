import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";

// Mirrors the WHATWG URL parser's pre-scheme step: leading C0
// controls and U+0020 SPACE are stripped, then ASCII tab / LF / CR
// characters inside the URL are also filtered out before the
// scheme is matched. https://url.spec.whatwg.org/#url-parsing
//
// Doing the filter in code (and keeping the regex literal free of
// control characters) avoids `eslint(no-control-regex)` warnings —
// inline `[\u0000-\u001F]` and `[\r\n\t]*` between letters would
// trip the lint at every rule-file load.
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

const extractStaticStringValue = (node: EsTreeNode | null | undefined): string | null => {
  if (!node) return null;
  if (isNodeOfType(node, "Literal") && typeof node.value === "string") return node.value;
  if (isNodeOfType(node, "TemplateLiteral") && node.expressions.length === 0) {
    return node.quasis.map((quasi) => quasi.value.cooked ?? "").join("");
  }
  return null;
};

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
