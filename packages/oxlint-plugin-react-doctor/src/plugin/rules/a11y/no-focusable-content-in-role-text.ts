import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getAuthoritativeJsxAttribute } from "../../utils/get-authoritative-jsx-attribute.js";
import { getStringLiteralAttributeValue } from "../../utils/get-string-literal-attribute-value.js";
import { isFocusableJsxOpeningElement } from "../../utils/is-focusable-jsx-opening-element.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { resolveJsxElementType } from "../../utils/resolve-jsx-element-type.js";

const findRoleTextAncestor = (
  node: EsTreeNodeOfType<"JSXOpeningElement">,
): EsTreeNodeOfType<"JSXOpeningElement"> | null => {
  let ancestor: EsTreeNode | null | undefined = node.parent?.parent;
  while (ancestor) {
    if (isNodeOfType(ancestor, "JSXAttribute")) return null;
    if (isNodeOfType(ancestor, "JSXElement")) {
      const openingElement = ancestor.openingElement;
      const elementType = resolveJsxElementType(openingElement);
      if (/^[A-Z]/.test(elementType)) return null;
      const roleAttribute = getAuthoritativeJsxAttribute(openingElement.attributes, "role", false);
      if (
        roleAttribute &&
        getStringLiteralAttributeValue(roleAttribute)?.trim().toLowerCase().split(/\s+/)[0] ===
          "text"
      ) {
        return openingElement;
      }
    }
    ancestor = ancestor.parent;
  }
  return null;
};

export const noFocusableContentInRoleText = defineRule({
  id: "no-focusable-content-in-role-text",
  title: "Focusable control inside role=text",
  severity: "warn",
  category: "Accessibility",
  defaultEnabled: false,
  recommendation:
    "Move interactive descendants outside role=text, or remove role=text so their semantics remain available.",
  create: (context) => ({
    JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
      const elementType = resolveJsxElementType(node);
      if (/^[A-Z]/.test(elementType) || !isFocusableJsxOpeningElement(node, elementType)) return;
      if (!findRoleTextAncestor(node)) return;
      context.report({
        node,
        message:
          "This focusable control sits inside role=text, which can flatten descendant semantics and hide the control from assistive technology. Move it outside or remove role=text.",
      });
    },
  }),
});
