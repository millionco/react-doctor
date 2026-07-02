import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getJsxAttributeName } from "../../utils/get-jsx-attribute-name.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";

const ACCESSIBLE_NAME_ATTRIBUTES = new Set(["aria-label", "aria-labelledby"]);

// Elements whose accessible name matters even without an explicit role or
// handler: intrinsically interactive or labelable landmarks/media.
const NAMING_RELEVANT_TAGS = new Set([
  "button",
  "a",
  "input",
  "select",
  "textarea",
  "summary",
  "img",
  "iframe",
  "audio",
  "video",
  "dialog",
  "nav",
  "section",
  "form",
  "fieldset",
]);

const INTERACTION_ATTRIBUTE_NAMES = new Set([
  "role",
  "tabindex",
  "onclick",
  "onkeydown",
  "onkeyup",
  "onkeypress",
]);

const PRESENTATIONAL_ROLES = new Set(["presentation", "none"]);

const isEmptyStringLiteral = (node: EsTreeNode): boolean =>
  isNodeOfType(node, "Literal") && node.value === "";

// Only fires on values that STATICALLY collapse to the empty string: a
// literal `""` ("literal"), or a `??`/`||` fallback whose right operand is
// `""` / a ternary with an empty-string branch ("fallback"). Identifiers,
// calls, and non-empty templates carry a real (or unknown) name and stay
// quiet.
const classifyEmptyAccessibleName = (valueNode: EsTreeNode): "literal" | "fallback" | null => {
  const node = stripParenExpression(valueNode);
  if (isEmptyStringLiteral(node)) return "literal";
  if (
    isNodeOfType(node, "LogicalExpression") &&
    (node.operator === "??" || node.operator === "||") &&
    isEmptyStringLiteral(stripParenExpression(node.right))
  ) {
    return "fallback";
  }
  if (
    isNodeOfType(node, "ConditionalExpression") &&
    (isEmptyStringLiteral(stripParenExpression(node.consequent)) ||
      isEmptyStringLiteral(stripParenExpression(node.alternate)))
  ) {
    return "fallback";
  }
  return null;
};

const classifyAttributeValue = (
  attribute: EsTreeNodeOfType<"JSXAttribute">,
): "literal" | "fallback" | null => {
  const value = attribute.value;
  if (!value) return null;
  const target = isNodeOfType(value, "JSXExpressionContainer") ? value.expression : value;
  if (!target) return null;
  return classifyEmptyAccessibleName(target);
};

const isAriaHiddenActive = (attribute: EsTreeNodeOfType<"JSXAttribute">): boolean => {
  const value = attribute.value;
  if (!value) return true;
  if (isNodeOfType(value, "Literal")) return value.value !== "false";
  if (isNodeOfType(value, "JSXExpressionContainer")) {
    const expression = stripParenExpression(value.expression);
    if (isNodeOfType(expression, "Literal")) {
      return expression.value !== false && expression.value !== "false";
    }
    return true;
  }
  return false;
};

const isPresentationalRole = (attribute: EsTreeNodeOfType<"JSXAttribute">): boolean => {
  const value = attribute.value;
  return (
    Boolean(value) &&
    isNodeOfType(value, "Literal") &&
    typeof value.value === "string" &&
    PRESENTATIONAL_ROLES.has(value.value.toLowerCase())
  );
};

const getIntrinsicTagName = (openingElement: EsTreeNode): string | null => {
  if (!isNodeOfType(openingElement, "JSXOpeningElement")) return null;
  const nameNode = openingElement.name;
  if (!isNodeOfType(nameNode, "JSXIdentifier")) return null;
  return /^[a-z]/.test(nameNode.name) ? nameNode.name : null;
};

// Per the accname algorithm an empty aria-label is skipped and the name
// falls back to contents, so any non-whitespace child means the control is
// not actually nameless.
const hasNameProvidingChildren = (element: EsTreeNodeOfType<"JSXElement">): boolean => {
  for (const childNode of element.children ?? []) {
    if (isNodeOfType(childNode, "JSXText")) {
      if (typeof childNode.value === "string" && childNode.value.trim() !== "") return true;
      continue;
    }
    if (isNodeOfType(childNode, "JSXExpressionContainer")) {
      if (isNodeOfType(childNode.expression, "JSXEmptyExpression")) continue;
      return true;
    }
    if (isNodeOfType(childNode, "JSXElement") || isNodeOfType(childNode, "JSXFragment")) {
      return true;
    }
  }
  return false;
};

export const noEmptyAriaLabel = defineRule({
  id: "no-empty-aria-label",
  title: "Empty ARIA accessible name",
  tags: ["react-jsx-only"],
  severity: "warn",
  recommendation:
    "Give `aria-label`/`aria-labelledby` a non-empty value so the control has an accessible name for screen readers.",
  create: (context) => ({
    JSXElement(element: EsTreeNodeOfType<"JSXElement">) {
      const openingElement = element.openingElement;
      const tagName = getIntrinsicTagName(openingElement);
      if (!tagName) return;

      const emptyNameAttributes: {
        attribute: EsTreeNodeOfType<"JSXAttribute">;
        attributeName: string;
        form: "literal" | "fallback";
      }[] = [];
      let hasNonEmptyNameSource = false;
      let hasNamingRelevantAttribute = false;

      for (const attributeNode of openingElement.attributes ?? []) {
        if (!isNodeOfType(attributeNode, "JSXAttribute")) continue;
        const attributeName = getJsxAttributeName(attributeNode.name)?.toLowerCase();
        if (!attributeName) continue;
        if (attributeName === "aria-hidden" && isAriaHiddenActive(attributeNode)) return;
        if (attributeName === "role" && isPresentationalRole(attributeNode)) return;
        if (INTERACTION_ATTRIBUTE_NAMES.has(attributeName)) hasNamingRelevantAttribute = true;
        if (!ACCESSIBLE_NAME_ATTRIBUTES.has(attributeName)) continue;
        const form = classifyAttributeValue(attributeNode);
        if (form === null) {
          if (attributeNode.value) hasNonEmptyNameSource = true;
          continue;
        }
        emptyNameAttributes.push({ attribute: attributeNode, attributeName, form });
      }

      if (emptyNameAttributes.length === 0) return;
      if (hasNonEmptyNameSource) return;
      if (hasNameProvidingChildren(element)) return;

      const isNamingRelevantElement =
        NAMING_RELEVANT_TAGS.has(tagName) || hasNamingRelevantAttribute;

      for (const { attribute, attributeName, form } of emptyNameAttributes) {
        if (form === "fallback" && !isNamingRelevantElement) continue;
        context.report({
          node: attribute,
          message: `Screen reader users hear this control with no name because \`${attributeName}\` resolves to an empty string, so give it a non-empty accessible name.`,
        });
      }
    },
  }),
});
