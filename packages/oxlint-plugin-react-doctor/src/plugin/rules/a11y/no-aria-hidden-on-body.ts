import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getAuthoritativeJsxAttribute } from "../../utils/get-authoritative-jsx-attribute.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { resolveJsxElementType } from "../../utils/resolve-jsx-element-type.js";

const isStaticallyTrue = (attribute: EsTreeNodeOfType<"JSXAttribute">): boolean => {
  if (!attribute.value) return true;
  if (isNodeOfType(attribute.value, "Literal")) return attribute.value.value === "true";
  return Boolean(
    isNodeOfType(attribute.value, "JSXExpressionContainer") &&
    isNodeOfType(attribute.value.expression, "Literal") &&
    (attribute.value.expression.value === true || attribute.value.expression.value === "true"),
  );
};

export const noAriaHiddenOnBody = defineRule({
  id: "no-aria-hidden-on-body",
  title: "Document body hidden from assistive technology",
  severity: "error",
  category: "Accessibility",
  defaultEnabled: false,
  recommendation: "Remove aria-hidden from the document body and hide only the intended subtree.",
  create: (context) => ({
    JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
      if (resolveJsxElementType(node) !== "body") return;
      const attribute = getAuthoritativeJsxAttribute(node.attributes, "aria-hidden", false);
      if (!attribute || !isStaticallyTrue(attribute)) return;
      context.report({
        node: attribute,
        message:
          "aria-hidden on the document body removes the entire page from the accessibility tree. Hide only the specific inactive region instead.",
      });
    },
  }),
});
