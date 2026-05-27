import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";

// A `javascript:` URL can contain leading C0 control or U+0020 SPACE,
// and any newline or tab is filtered out as if it's not part of the
// URL. https://url.spec.whatwg.org/#url-parsing
// HACK: control-character class is the URL-spec definition; the regex
// matches exactly what browsers strip before resolving the protocol.
// eslint-disable-next-line no-control-regex
const JAVASCRIPT_PROTOCOL_PATTERN =
  /^[\u0000-\u001F ]*j[\r\n\t]*a[\r\n\t]*v[\r\n\t]*a[\r\n\t]*s[\r\n\t]*c[\r\n\t]*r[\r\n\t]*i[\r\n\t]*p[\r\n\t]*t[\r\n\t]*:/i;

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
      if (stringValue && JAVASCRIPT_PROTOCOL_PATTERN.test(stringValue)) {
        context.report({
          node: node.value,
          message: "For security, don't use `javascript:` URLs. Use event handlers instead.",
        });
      }
    },
  }),
});
