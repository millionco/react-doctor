import { HTML_TAGS } from "../../constants/html-tags.js";
import { defineRule } from "../../utils/define-rule.js";
import { getUnvariantClassNameTokens } from "../../utils/get-unvariant-class-name-tokens.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getJsxAttributeName } from "../../utils/get-jsx-attribute-name.js";
import { getStringLiteralAttributeValue } from "../../utils/get-string-literal-attribute-value.js";
import { hasJsxPropIgnoreCase } from "../../utils/has-jsx-prop-ignore-case.js";
import { hasJsxSpreadAttribute } from "../../utils/has-jsx-spread-attribute.js";
import { isInteractiveElement } from "../../utils/is-interactive-element.js";
import { isInteractiveRole } from "../../utils/is-interactive-role.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { resolveJsxElementType } from "../../utils/resolve-jsx-element-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { getStringFromClassNameAttr } from "./utils/get-string-from-class-name-attr.js";
import { getLastMatchingToken } from "./utils/get-last-matching-token.js";

const POINTER_HANDLER_PATTERN = /^on(?:click|pointer|mouse|touch|drag)/i;

const hasPointerBehaviorSignal = (
  openingElement: EsTreeNodeOfType<"JSXOpeningElement">,
): boolean => {
  if (hasJsxSpreadAttribute(openingElement.attributes)) return true;
  if (
    hasJsxPropIgnoreCase(openingElement.attributes, "tabIndex") ||
    hasJsxPropIgnoreCase(openingElement.attributes, "draggable") ||
    hasJsxPropIgnoreCase(openingElement.attributes, "contentEditable")
  ) {
    return true;
  }
  for (const attribute of openingElement.attributes) {
    if (!isNodeOfType(attribute, "JSXAttribute")) continue;
    const attributeName = getJsxAttributeName(attribute.name);
    if (attributeName && POINTER_HANDLER_PATTERN.test(attributeName)) return true;
  }
  const roleAttribute = hasJsxPropIgnoreCase(openingElement.attributes, "role");
  if (!roleAttribute) return false;
  const roleValue = getStringLiteralAttributeValue(roleAttribute);
  if (roleValue === null) return true;
  const firstRole = roleValue.trim().toLowerCase().split(/\s+/)[0];
  return Boolean(firstRole && isInteractiveRole(firstRole));
};

const isInteractionBoundary = (openingElement: EsTreeNodeOfType<"JSXOpeningElement">): boolean => {
  const elementType = resolveJsxElementType(openingElement);
  return (
    elementType === "label" ||
    (HTML_TAGS.has(elementType) && isInteractiveElement(elementType, openingElement)) ||
    hasPointerBehaviorSignal(openingElement)
  );
};

const hasWrappingInteractionBoundary = (
  openingElement: EsTreeNodeOfType<"JSXOpeningElement">,
): boolean => {
  let ancestor: EsTreeNode | null | undefined = openingElement.parent?.parent;
  while (ancestor) {
    if (isNodeOfType(ancestor, "JSXAttribute")) {
      const isChildrenAttribute =
        isNodeOfType(ancestor.name, "JSXIdentifier") && ancestor.name.name === "children";
      if (!isChildrenAttribute) return false;
    }
    if (isNodeOfType(ancestor, "JSXElement") && isInteractionBoundary(ancestor.openingElement)) {
      return true;
    }
    ancestor = ancestor.parent;
  }
  return false;
};

export const noInertPointerAffordance = defineRule({
  id: "no-inert-pointer-affordance",
  title: "Pointer cursor has no interaction",
  severity: "warn",
  defaultEnabled: false,
  tags: ["design", "test-noise", "react-jsx-only"],
  requires: ["tailwind"],
  category: "Accessibility",
  recommendation:
    "Remove the pointer cursor or put the affordance on the control that actually handles the interaction.",
  create: (context: RuleContext) => ({
    JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
      const elementType = resolveJsxElementType(node);
      if (!HTML_TAGS.has(elementType) || isInteractiveElement(elementType, node)) return;
      const classNameValue = getStringFromClassNameAttr(node);
      if (!classNameValue) return;
      const cursorUtility = getLastMatchingToken(
        getUnvariantClassNameTokens(classNameValue),
        (utility) => utility.startsWith("cursor-"),
      );
      if (cursorUtility !== "cursor-pointer") return;
      if (elementType === "label" || hasPointerBehaviorSignal(node)) return;
      if (hasWrappingInteractionBoundary(node)) return;
      context.report({
        node,
        message:
          "This pointer cursor promises an interaction, but neither this element nor its wrapping surface handles one.",
      });
    },
  }),
});
