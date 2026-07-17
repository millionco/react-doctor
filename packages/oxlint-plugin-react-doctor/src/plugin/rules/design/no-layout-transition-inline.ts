import { LAYOUT_TRANSITION_PROPERTIES } from "../../constants/style.js";
import { defineRule } from "../../utils/define-rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { getEffectiveStyleProperty } from "./utils/get-effective-style-property.js";
import { getInlineStyleExpression } from "./utils/get-inline-style-expression.js";
import { getStylePropertyStringValue } from "./utils/get-style-property-string-value.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isSvgLayoutTransitionExemptElementName } from "./utils/is-svg-layout-transition-exempt-element-name.js";

const isSvgElementAttribute = (node: EsTreeNodeOfType<"JSXAttribute">): boolean => {
  const openingElement = node.parent;
  return Boolean(
    openingElement &&
    isNodeOfType(openingElement, "JSXOpeningElement") &&
    isNodeOfType(openingElement.name, "JSXIdentifier") &&
    isSvgLayoutTransitionExemptElementName(openingElement.name.name),
  );
};

export const noLayoutTransitionInline = defineRule({
  id: "no-layout-transition-inline",
  title: "Animating layout properties",
  tags: ["test-noise"],
  severity: "warn",
  category: "Performance",
  recommendation:
    "Animate `transform` and `opacity` instead, since they're cheap for the browser. For height, animate `grid-template-rows` from `0fr` to `1fr`.",
  create: (context: RuleContext) => ({
    JSXAttribute(node: EsTreeNodeOfType<"JSXAttribute">) {
      const expression = getInlineStyleExpression(node);
      if (!expression) return;
      if (isSvgElementAttribute(node)) return;

      for (const key of ["transition", "transitionProperty"]) {
        const property = getEffectiveStyleProperty(expression.properties, key);
        if (!property) continue;
        const value = getStylePropertyStringValue(property);
        if (!value) continue;

        const valueTokens = value.toLowerCase().split(/[\s,]+/);
        if (valueTokens.includes("all")) continue;

        const layoutProperty = valueTokens.find((valueToken) =>
          LAYOUT_TRANSITION_PROPERTIES.has(valueToken),
        );
        if (layoutProperty) {
          context.report({
            node: property,
            message: `Your users see janky, stuttering animation because "${layoutProperty}" relayouts the page every frame, so animate transform & opacity instead.`,
          });
        }
      }
    },
  }),
});
