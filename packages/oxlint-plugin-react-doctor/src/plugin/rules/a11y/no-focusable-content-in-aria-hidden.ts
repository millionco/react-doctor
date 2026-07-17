import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getAuthoritativeJsxAttribute } from "../../utils/get-authoritative-jsx-attribute.js";
import { isFocusableJsxOpeningElement } from "../../utils/is-focusable-jsx-opening-element.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { resolveJsxElementType } from "../../utils/resolve-jsx-element-type.js";
import type { RuleContext } from "../../utils/rule-context.js";

const isStaticallyAriaHidden = (openingElement: EsTreeNodeOfType<"JSXOpeningElement">): boolean => {
  if (
    !isNodeOfType(openingElement.name, "JSXIdentifier") ||
    /^[A-Z]/.test(openingElement.name.name)
  ) {
    return false;
  }
  const attribute = getAuthoritativeJsxAttribute(openingElement.attributes, "aria-hidden", false);
  if (!attribute) return false;
  if (!attribute.value) return true;
  if (isNodeOfType(attribute.value, "Literal")) return attribute.value.value === "true";
  return Boolean(
    isNodeOfType(attribute.value, "JSXExpressionContainer") &&
    isNodeOfType(attribute.value.expression, "Literal") &&
    (attribute.value.expression.value === true || attribute.value.expression.value === "true"),
  );
};

const getHiddenAncestor = (
  node: EsTreeNodeOfType<"JSXOpeningElement">,
): EsTreeNodeOfType<"JSXOpeningElement"> | null => {
  let ancestor: EsTreeNode | null | undefined = node.parent?.parent;
  while (ancestor) {
    if (isNodeOfType(ancestor, "JSXElement") && isStaticallyAriaHidden(ancestor.openingElement)) {
      return ancestor.openingElement;
    }
    ancestor = ancestor.parent;
  }
  return null;
};

export const noFocusableContentInAriaHidden = defineRule({
  id: "no-focusable-content-in-aria-hidden",
  title: "aria-hidden subtree contains focusable content",
  severity: "warn",
  category: "Accessibility",
  recommendation:
    "Remove focusable descendants from aria-hidden content, or hide and disable the whole subtree together.",
  create: (context: RuleContext) => ({
    JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
      const tagName = resolveJsxElementType(node);
      if (/^[A-Z]/.test(tagName) || !isFocusableJsxOpeningElement(node, tagName)) return;
      const hiddenAncestor = getHiddenAncestor(node);
      if (!hiddenAncestor) return;
      context.report({
        node,
        message:
          "This control remains keyboard-focusable inside an aria-hidden subtree, so focus can move to content assistive technology cannot perceive. Remove it from the tab order or stop hiding its ancestor.",
      });
    },
  }),
});
