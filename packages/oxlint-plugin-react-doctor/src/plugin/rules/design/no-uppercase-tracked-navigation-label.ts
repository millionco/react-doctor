import { SHORT_DECORATIVE_LABEL_MAX_CHARACTERS } from "../../constants/design.js";
import { defineRule } from "../../utils/define-rule.js";
import { getStaticJsxText } from "../../utils/get-static-jsx-text.js";
import { getUnvariantClassNameTokens } from "../../utils/get-unvariant-class-name-tokens.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { getStringFromClassNameAttr } from "./utils/get-string-from-class-name-attr.js";
import { isInsideNavigation } from "./utils/is-inside-navigation.js";

const PREFORMATTED_ELEMENT_NAMES = new Set(["code", "kbd", "pre", "samp", "var"]);

export const noUppercaseTrackedNavigationLabel = defineRule({
  id: "no-uppercase-tracked-navigation-label",
  title: "Navigation label uses uppercase tracking",
  severity: "warn",
  defaultEnabled: false,
  tags: ["design", "test-noise"],
  recommendation: "Use ordinary casing and tracking for persistent navigation labels.",
  create: (context: RuleContext) => ({
    JSXElement(node: EsTreeNodeOfType<"JSXElement">) {
      if (
        !isNodeOfType(node.openingElement.name, "JSXIdentifier") ||
        PREFORMATTED_ELEMENT_NAMES.has(node.openingElement.name.name) ||
        node.children.some((child) => isNodeOfType(child, "JSXExpressionContainer")) ||
        !isInsideNavigation(node)
      ) {
        return;
      }
      const text = getStaticJsxText(node).replace(/\s+/g, " ").trim();
      if (!text || text.length > SHORT_DECORATIVE_LABEL_MAX_CHARACTERS) return;
      const classNameValue = getStringFromClassNameAttr(node.openingElement);
      if (!classNameValue) return;
      const tokens = getUnvariantClassNameTokens(classNameValue);
      if (!tokens.includes("uppercase") || !tokens.some((token) => token.startsWith("tracking-"))) {
        return;
      }
      context.report({
        node: node.openingElement,
        message:
          "This persistent navigation label uses uppercase tracking as decoration. Use ordinary interface casing and spacing for faster scanning.",
      });
    },
  }),
});
