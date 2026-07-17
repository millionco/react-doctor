import { defineRule } from "../../utils/define-rule.js";
import { getStaticJsxText } from "../../utils/get-static-jsx-text.js";
import { getUnvariantClassNameTokens } from "../../utils/get-unvariant-class-name-tokens.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { getStringFromClassNameAttr } from "./utils/get-string-from-class-name-attr.js";
import { hasVisibleTailwindFillOrEdge } from "./utils/has-visible-tailwind-fill-or-edge.js";
import { isInsideNavigation } from "./utils/is-inside-navigation.js";

const COUNT_ELEMENTS = new Set(["small", "span"]);
const HORIZONTAL_PADDING_PATTERN = /^px-(?:px|[\d.]+|\[[^\]]+\])$/;

export const noPillNavigationCount = defineRule({
  id: "no-pill-navigation-count",
  title: "Navigation count uses a pill badge",
  severity: "warn",
  defaultEnabled: false,
  tags: ["design", "test-noise"],
  recommendation:
    "Align navigation counts as plain tabular text instead of decorating each value as a pill.",
  create: (context: RuleContext) => ({
    JSXElement(node: EsTreeNodeOfType<"JSXElement">) {
      if (
        !isNodeOfType(node.openingElement.name, "JSXIdentifier") ||
        !COUNT_ELEMENTS.has(node.openingElement.name.name) ||
        node.children.some((child) => isNodeOfType(child, "JSXExpressionContainer")) ||
        !/^\d+$/.test(getStaticJsxText(node).trim()) ||
        !isInsideNavigation(node)
      ) {
        return;
      }
      const classNameValue = getStringFromClassNameAttr(node.openingElement);
      if (!classNameValue) return;
      const tokens = getUnvariantClassNameTokens(classNameValue);
      if (
        !tokens.includes("rounded-full") ||
        !tokens.some((token) => HORIZONTAL_PADDING_PATTERN.test(token)) ||
        !hasVisibleTailwindFillOrEdge(tokens)
      ) {
        return;
      }
      context.report({
        node: node.openingElement,
        message:
          "This navigation count is styled as a pill, adding visual noise to a repeated row. Use aligned plain text with tabular numerals.",
      });
    },
  }),
});
