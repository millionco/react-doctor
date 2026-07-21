import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getAuthoritativeJsxAttribute } from "../../utils/get-authoritative-jsx-attribute.js";
import { hasJsxSpreadAttribute } from "../../utils/has-jsx-spread-attribute.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import {
  isTailwindCardSurface,
  isTailwindPaddedCardSurface,
} from "./utils/is-tailwind-card-surface.js";

const CARD_CONTAINER_ELEMENT_NAMES = new Set([
  "article",
  "aside",
  "details",
  "div",
  "fieldset",
  "figure",
  "form",
  "li",
  "main",
  "section",
]);

const isCardContainer = (node: EsTreeNodeOfType<"JSXElement">): boolean =>
  isNodeOfType(node.openingElement.name, "JSXIdentifier") &&
  CARD_CONTAINER_ELEMENT_NAMES.has(node.openingElement.name.name) &&
  !getAuthoritativeJsxAttribute(node.openingElement.attributes, "style") &&
  !hasJsxSpreadAttribute(node.openingElement.attributes);

const hasCardAncestor = (node: EsTreeNode): boolean => {
  let ancestor = node.parent;
  while (ancestor) {
    if (isNodeOfType(ancestor, "JSXElement")) {
      if (
        isNodeOfType(ancestor.openingElement.name, "JSXIdentifier") &&
        ancestor.openingElement.name.name !== ancestor.openingElement.name.name.toLowerCase()
      ) {
        return false;
      }
      if (isCardContainer(ancestor) && isTailwindCardSurface(ancestor.openingElement)) return true;
    }
    ancestor = ancestor.parent;
  }
  return false;
};

export const noNestedCardSurface = defineRule({
  id: "no-nested-card-surface",
  title: "Card surface is nested inside another card",
  severity: "warn",
  defaultEnabled: false,
  requires: ["tailwind"],
  tags: ["design", "test-noise"],
  recommendation:
    "Flatten the inner surface and use spacing, a divider, or typography to communicate the hierarchy.",
  create: (context: RuleContext) => ({
    JSXElement(node: EsTreeNodeOfType<"JSXElement">) {
      if (
        !isCardContainer(node) ||
        !isTailwindPaddedCardSurface(node.openingElement) ||
        !hasCardAncestor(node)
      ) {
        return;
      }
      context.report({
        node: node.openingElement,
        message:
          "This full card treatment sits inside another card and adds unnecessary visual depth. Flatten the inner group.",
      });
    },
  }),
});
