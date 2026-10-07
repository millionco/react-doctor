import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getAuthoritativeJsxAttribute } from "../../utils/get-authoritative-jsx-attribute.js";
import { getStaticJsxDescendantOpeningElements } from "../../utils/get-static-jsx-descendant-opening-elements.js";
import { getStringLiteralAttributeValue } from "../../utils/get-string-literal-attribute-value.js";
import { isFocusableJsxOpeningElement } from "../../utils/is-focusable-jsx-opening-element.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { resolveJsxElementType } from "../../utils/resolve-jsx-element-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { splitTailwindClassName } from "../../utils/split-tailwind-class-name.js";

const BOOTSTRAP_MODAL_DISMISS_ATTRIBUTES = ["data-bs-dismiss", "data-dismiss"];

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

const isBootstrapManagedModal = (
  openingElement: EsTreeNodeOfType<"JSXOpeningElement">,
): boolean => {
  const classNameAttribute = getAuthoritativeJsxAttribute(
    openingElement.attributes,
    "className",
    false,
  );
  const classNameValue = classNameAttribute
    ? getStringLiteralAttributeValue(classNameAttribute)
    : null;
  if (!classNameValue || !splitTailwindClassName(classNameValue).includes("modal")) return false;
  const element = openingElement.parent;
  if (!element || !isNodeOfType(element, "JSXElement")) return false;
  return getStaticJsxDescendantOpeningElements(element).some((descendant) =>
    BOOTSTRAP_MODAL_DISMISS_ATTRIBUTES.some((attributeName) => {
      const attribute = getAuthoritativeJsxAttribute(descendant.attributes, attributeName, false);
      return attribute ? getStringLiteralAttributeValue(attribute) === "modal" : false;
    }),
  );
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
      if (isBootstrapManagedModal(hiddenAncestor)) return;
      context.report({
        node,
        message:
          "This control remains keyboard-focusable inside an aria-hidden subtree, so focus can move to content assistive technology cannot perceive. Remove it from the tab order or stop hiding its ancestor.",
      });
    },
  }),
});
