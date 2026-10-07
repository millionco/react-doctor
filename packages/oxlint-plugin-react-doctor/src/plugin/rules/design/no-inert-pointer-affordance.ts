import { HTML_TAGS } from "../../constants/html-tags.js";
import { defineRule } from "../../utils/define-rule.js";
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
import { walkAst } from "../../utils/walk-ast.js";
import { splitTailwindClassName } from "../../utils/split-tailwind-class-name.js";
import { getEffectiveTailwindClassNameToken } from "./utils/get-effective-tailwind-class-name-token.js";
import { getStringFromClassNameAttr } from "./utils/get-string-from-class-name-attr.js";

const POINTER_HANDLER_PATTERN = /^on(?:click|pointer|mouse|touch|drag)/i;

const hasPointerBehaviorSignal = (
  openingElement: EsTreeNodeOfType<"JSXOpeningElement">,
): boolean => {
  if (hasJsxSpreadAttribute(openingElement.attributes)) return true;
  if (
    hasJsxPropIgnoreCase(openingElement.attributes, "tabIndex") ||
    hasJsxPropIgnoreCase(openingElement.attributes, "ref") ||
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
    !HTML_TAGS.has(elementType) ||
    elementType === "label" ||
    isInteractiveElement(elementType, openingElement) ||
    hasPointerBehaviorSignal(openingElement)
  );
};

const hasNestedInteractionBoundary = (
  openingElement: EsTreeNodeOfType<"JSXOpeningElement">,
): boolean => {
  const element = openingElement.parent;
  if (!isNodeOfType(element, "JSXElement")) return false;
  let didFindInteractionBoundary = false;
  for (const child of element.children) {
    walkAst(child, (descendant) => {
      if (!isNodeOfType(descendant, "JSXOpeningElement")) return;
      if (!isInteractionBoundary(descendant)) return;
      didFindInteractionBoundary = true;
      return false;
    });
  }
  return didFindInteractionBoundary;
};

const hasWrappingInteractionBoundary = (
  openingElement: EsTreeNodeOfType<"JSXOpeningElement">,
): boolean => {
  let ancestor: EsTreeNode | null | undefined = openingElement.parent?.parent;
  while (ancestor) {
    if (isNodeOfType(ancestor, "JSXAttribute")) {
      return true;
    }
    if (isNodeOfType(ancestor, "JSXElement")) {
      const elementType = resolveJsxElementType(ancestor.openingElement);
      if (!HTML_TAGS.has(elementType) || isInteractionBoundary(ancestor.openingElement))
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
      const cursorUtility = getEffectiveTailwindClassNameToken(
        splitTailwindClassName(classNameValue),
        (utility) => utility.startsWith("cursor-"),
      );
      if (cursorUtility !== "cursor-pointer") return;
      if (elementType === "label" || hasPointerBehaviorSignal(node)) return;
      if (hasWrappingInteractionBoundary(node)) return;
      if (hasNestedInteractionBoundary(node)) return;
      context.report({
        node,
        message:
          "This pointer cursor promises an interaction, but neither this element nor its wrapping surface handles one.",
      });
    },
  }),
});
