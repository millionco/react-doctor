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

// Port of `solid/no-innerhtml` — flags `innerHTML={...}` (a Solid
// special prop) because passing unsanitized input is an XSS risk,
// plus the React-style `dangerouslySetInnerHTML` which Solid does
// not support. Static string values are still flagged because Solid
// reports them as dangerous when the rule is left at its default
// (we don't depend on `is-html` to keep the port footprint tight).
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
