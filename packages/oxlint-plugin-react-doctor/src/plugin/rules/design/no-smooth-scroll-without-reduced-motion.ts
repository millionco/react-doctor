import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { hasJsxSpreadAttribute } from "../../utils/has-jsx-spread-attribute.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { getEffectiveStyleProperty } from "./utils/get-effective-style-property.js";
import { getInlineStyleExpression } from "./utils/get-inline-style-expression.js";
import { getStringFromClassNameAttr } from "./utils/get-string-from-class-name-attr.js";
import { getStylePropertyStringValue } from "./utils/get-style-property-string-value.js";

const hasUnsafeSmoothScrollClass = (className: string): boolean => {
  const tokens = className.split(/\s+/);
  const hasReducedMotionFallback = tokens.some((token) =>
    /(?:^|:)motion-reduce:scroll-auto!?$/.test(token),
  );
  return tokens.some(
    (token) =>
      /(?:^|:)scroll-smooth!?$/.test(token) &&
      !/(?:^|:)motion-safe:/.test(token) &&
      !hasReducedMotionFallback,
  );
};

export const noSmoothScrollWithoutReducedMotion = defineRule({
  id: "no-smooth-scroll-without-reduced-motion",
  title: "Smooth scrolling ignores reduced motion",
  severity: "warn",
  category: "Accessibility",
  defaultEnabled: false,
  recommendation:
    "Enable smooth scrolling only for users without a reduced-motion preference, and fall back to instant scrolling for everyone else.",
  create: (context: RuleContext) => {
    const reportedElements = new Set<EsTreeNode>();
    return {
      JSXAttribute(node: EsTreeNodeOfType<"JSXAttribute">) {
        const expression = getInlineStyleExpression(node);
        if (!expression) return;
        const property = getEffectiveStyleProperty(expression.properties, "scrollBehavior");
        if (!property || getStylePropertyStringValue(property) !== "smooth") return;
        const openingElement = node.parent;
        if (
          !openingElement ||
          !isNodeOfType(openingElement, "JSXOpeningElement") ||
          hasJsxSpreadAttribute(openingElement.attributes) ||
          reportedElements.has(openingElement)
        ) {
          return;
        }
        reportedElements.add(openingElement);
        context.report({
          node: property,
          message:
            "This inline smooth scrolling cannot adapt to the user's reduced-motion preference. Choose smooth or auto from that preference instead.",
        });
      },
      JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
        if (reportedElements.has(node) || hasJsxSpreadAttribute(node.attributes)) return;
        const className = getStringFromClassNameAttr(node);
        if (!className || !hasUnsafeSmoothScrollClass(className)) return;
        reportedElements.add(node);
        context.report({
          node,
          message:
            "This scroll-smooth utility also applies to users who request reduced motion. Gate it with motion-safe or add a motion-reduce scroll-auto fallback.",
        });
      },
    };
  },
});
