import { defineRule } from "../../utils/define-rule.js";
import { getAuthoritativeJsxAttribute } from "../../utils/get-authoritative-jsx-attribute.js";
import { getStaticJsxDescendantOpeningElements } from "../../utils/get-static-jsx-descendant-opening-elements.js";
import { getStringLiteralAttributeValue } from "../../utils/get-string-literal-attribute-value.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { hasJsxSpreadAttribute } from "../../utils/has-jsx-spread-attribute.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";

const NAVIGATION_CONTAINER_NAMES = new Set(["nav", "aside"]);

const isPlaceholderAnchor = (node: EsTreeNodeOfType<"JSXOpeningElement">): boolean => {
  if (
    !isNodeOfType(node.name, "JSXIdentifier") ||
    node.name.name !== "a" ||
    hasJsxSpreadAttribute(node.attributes)
  ) {
    return false;
  }
  const hrefAttribute = getAuthoritativeJsxAttribute(node.attributes, "href");
  return hrefAttribute !== null && getStringLiteralAttributeValue(hrefAttribute) === "#";
};

const isNavigationElement = (node: EsTreeNodeOfType<"JSXOpeningElement">): boolean =>
  isNodeOfType(node.name, "JSXIdentifier") && node.name.name === "nav";

export const noRepeatedPlaceholderNavigation = defineRule({
  id: "no-repeated-placeholder-navigation",
  title: "Navigation repeats placeholder destinations",
  severity: "warn",
  defaultEnabled: false,
  tags: ["design", "test-noise", "react-jsx-only"],
  category: "Design",
  recommendation:
    "Replace placeholder destinations with real routes or render non-interactive navigation previews until destinations exist.",
  create: (context: RuleContext) => ({
    JSXElement(node: EsTreeNodeOfType<"JSXElement">) {
      if (
        !isNodeOfType(node.openingElement.name, "JSXIdentifier") ||
        !NAVIGATION_CONTAINER_NAMES.has(node.openingElement.name.name)
      ) {
        return;
      }
      const descendants = getStaticJsxDescendantOpeningElements(node);
      if (node.openingElement.name.name === "aside" && descendants.some(isNavigationElement)) {
        return;
      }
      const [, secondPlaceholderAnchor] = descendants.filter(isPlaceholderAnchor);
      if (!secondPlaceholderAnchor) return;
      context.report({
        node: node.openingElement,
        message:
          "This navigation contains multiple links with placeholder destinations. Connect them to real routes or use non-interactive previews.",
      });
    },
  }),
});
