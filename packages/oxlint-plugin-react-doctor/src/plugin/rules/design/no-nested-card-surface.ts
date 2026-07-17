import { defineRule } from "../../utils/define-rule.js";
import { getClassNameTokens } from "../../utils/get-class-name-tokens.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { getStringFromClassNameAttr } from "./utils/get-string-from-class-name-attr.js";

const isCardSurface = (node: EsTreeNodeOfType<"JSXOpeningElement">): boolean => {
  const classNameValue = getStringFromClassNameAttr(node);
  if (!classNameValue) return false;
  const tokens = getClassNameTokens(classNameValue);
  const hasRounding = tokens.some(
    (token) => token === "rounded" || (token.startsWith("rounded-") && token !== "rounded-none"),
  );
  const hasBoundary = tokens.some(
    (token) =>
      token === "border" ||
      token.startsWith("border-") ||
      token === "shadow" ||
      token.startsWith("shadow-") ||
      token === "ring" ||
      token.startsWith("ring-"),
  );
  const hasInterior = tokens.some(
    (token) => /^(?:p|px|py)-/.test(token) || token.startsWith("bg-"),
  );
  return hasRounding && hasBoundary && hasInterior;
};

const hasCardAncestor = (node: EsTreeNode): boolean => {
  let ancestor = node.parent;
  while (ancestor) {
    if (isNodeOfType(ancestor, "JSXElement") && isCardSurface(ancestor.openingElement)) return true;
    ancestor = ancestor.parent;
  }
  return false;
};

export const noNestedCardSurface = defineRule({
  id: "no-nested-card-surface",
  title: "Card surface is nested inside another card",
  severity: "warn",
  defaultEnabled: false,
  tags: ["design", "test-noise"],
  recommendation:
    "Flatten the inner surface and use spacing, a divider, or typography to communicate the hierarchy.",
  create: (context: RuleContext) => ({
    JSXElement(node: EsTreeNodeOfType<"JSXElement">) {
      if (!isCardSurface(node.openingElement) || !hasCardAncestor(node)) return;
      context.report({
        node: node.openingElement,
        message:
          "This full card treatment sits inside another card and adds unnecessary visual depth. Flatten the inner group.",
      });
    },
  }),
});
