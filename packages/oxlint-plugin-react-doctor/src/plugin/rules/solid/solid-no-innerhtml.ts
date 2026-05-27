import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getJsxAttributeName } from "../../utils/get-jsx-attribute-name.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";

const extractInnerExpression = (attribute: EsTreeNodeOfType<"JSXAttribute">): EsTreeNode | null => {
  if (!attribute.value) return null;
  if (isNodeOfType(attribute.value, "JSXExpressionContainer")) {
    return attribute.value.expression as EsTreeNode;
  }
  return attribute.value as EsTreeNode;
};

const extractStaticStringValue = (node: EsTreeNode | null): string | null => {
  if (!node) return null;
  if (isNodeOfType(node, "Literal") && typeof node.value === "string") return node.value;
  if (isNodeOfType(node, "TemplateLiteral") && node.expressions.length === 0) {
    return node.quasis.map((quasi) => quasi.value.cooked ?? "").join("");
  }
  return null;
};

// Port of `solid/no-innerhtml`. Three distinct diagnostics:
//
//   1. `dangerouslySetInnerHTML={...}` — always flagged. Solid does
//      not honour the React-style prop, so any use is a silent bug.
//   2. `innerHTML={dynamic}` — flagged as dangerous XSS source.
//   3. `innerHTML="..."` on an element with JSX children — flagged
//      because the static markup overwrites the children.
//
// Static `innerHTML="..."` on a childless element is intentionally
// NOT flagged — this matches upstream's `allowStatic: true` default,
// which exists so authors can ship known-safe inline snippets without
// noise. Upstream additionally calls `is-html(value)` to suggest
// `innerText` when the literal isn't actually markup; we skip that
// to avoid pulling in the dataset, which only costs us the
// `notHtml` suggestion path — the security-relevant cases above are
// fully covered.
export const solidNoInnerHtml = defineRule<Rule>({
  id: "solid-no-innerhtml",
  severity: "error",
  requires: ["solid"],
  recommendation:
    "Avoid `innerHTML` — render children via JSX. If you must inject markup, sanitize input first.",
  create: (context: RuleContext) => ({
    JSXAttribute(node: EsTreeNodeOfType<"JSXAttribute">) {
      const propertyName = getJsxAttributeName(node.name);
      if (!propertyName) return;
      if (propertyName === "dangerouslySetInnerHTML") {
        context.report({
          node,
          message: "`dangerouslySetInnerHTML` is not supported in Solid — use `innerHTML` instead.",
        });
        return;
      }
      if (propertyName !== "innerHTML") return;
      const expression = extractInnerExpression(node);
      const staticString = extractStaticStringValue(expression);
      if (staticString === null) {
        context.report({
          node,
          message:
            "Avoid `innerHTML` with dynamic values — passing unsanitized input causes XSS vulnerabilities.",
        });
        return;
      }
      const opener = node.parent;
      const jsxElement = opener?.parent;
      if (jsxElement && isNodeOfType(jsxElement, "JSXElement") && jsxElement.children.length > 0) {
        context.report({
          node: jsxElement,
          message:
            "`innerHTML` should not be used on an element with child elements — children will be overwritten.",
        });
      }
    },
  }),
});
