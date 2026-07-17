import { defineRule } from "../../utils/define-rule.js";
import { findJsxAttribute } from "../../utils/find-jsx-attribute.js";
import { getStaticJsxText } from "../../utils/get-static-jsx-text.js";
import { getUnvariantClassNameTokens } from "../../utils/get-unvariant-class-name-tokens.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { getStringFromClassNameAttr } from "./utils/get-string-from-class-name-attr.js";

const BUSY_TEXT_PATTERN = /\b(?:loading|processing|saving|syncing|uploading)\b/i;

const getStaticAttributeValue = (attribute: EsTreeNodeOfType<"JSXAttribute">): unknown => {
  const value = attribute.value as EsTreeNode | null;
  if (!value) return true;
  const expression = isNodeOfType(value, "JSXExpressionContainer") ? value.expression : value;
  return isNodeOfType(expression, "Literal") ? expression.value : null;
};

const isBusyStatus = (openingElement: EsTreeNodeOfType<"JSXOpeningElement">): boolean => {
  const ariaBusyAttribute = findJsxAttribute(openingElement.attributes, "aria-busy");
  const ariaBusyValue = ariaBusyAttribute && getStaticAttributeValue(ariaBusyAttribute);
  if (ariaBusyValue === true || ariaBusyValue === "true" || ariaBusyValue === null) return true;
  const roleAttribute = findJsxAttribute(openingElement.attributes, "role");
  const roleValue = roleAttribute && getStaticAttributeValue(roleAttribute);
  return roleValue === "status" || roleValue === "progressbar";
};

export const noDecorativePulse = defineRule({
  id: "no-decorative-pulse",
  title: "Stable copy pulses for attention",
  severity: "warn",
  defaultEnabled: false,
  tags: ["design", "test-noise"],
  recommendation:
    "Reserve pulsing motion for real in-progress feedback. Use hierarchy and static contrast for announcements and feature labels.",
  create: (context: RuleContext) => ({
    JSXElement(node: EsTreeNodeOfType<"JSXElement">) {
      const openingElement = node.openingElement;
      const classNameValue = getStringFromClassNameAttr(openingElement);
      if (
        !classNameValue ||
        !getUnvariantClassNameTokens(classNameValue).includes("animate-pulse")
      ) {
        return;
      }
      const text = getStaticJsxText(node).replace(/\s+/g, " ").trim();
      if (!text || BUSY_TEXT_PATTERN.test(text)) return;
      if (isBusyStatus(openingElement)) return;
      context.report({
        node: openingElement,
        message:
          "This stable copy pulses continuously for attention. Remove the loop and use static hierarchy unless the element represents work in progress.",
      });
    },
  }),
});
