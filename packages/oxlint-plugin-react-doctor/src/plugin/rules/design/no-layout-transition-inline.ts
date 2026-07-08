import { defineRule } from "../../utils/define-rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { getInlineStyleExpression } from "./utils/get-inline-style-expression.js";
import { getStylePropertyStringValue } from "./utils/get-style-property-string-value.js";
import { getStylePropertyKey } from "./utils/get-style-property-key.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";

// Exact property names that trigger reflow when animated. Matching whole
// tokens (not substrings) keeps non-layout lookalikes like `stroke-width`
// (SVG paint) and `scroll-margin` (scroll-snap offset) silent.
const LAYOUT_TRANSITION_PROPERTIES = new Set([
  "width",
  "height",
  "min-width",
  "min-height",
  "max-width",
  "max-height",
  "padding",
  "padding-top",
  "padding-right",
  "padding-bottom",
  "padding-left",
  "margin",
  "margin-top",
  "margin-right",
  "margin-bottom",
  "margin-left",
  "border-width",
  "border-top-width",
  "border-right-width",
  "border-bottom-width",
  "border-left-width",
  "line-height",
  "column-width",
]);

// SVG geometry elements: transitioning `height` / `y` on a `<rect>`
// repaints the SVG region but never reflows the document, so the
// layout-thrash warning does not apply.
const SVG_GEOMETRY_ELEMENT_NAMES = new Set([
  "svg",
  "g",
  "rect",
  "circle",
  "ellipse",
  "line",
  "path",
  "polygon",
  "polyline",
  "text",
  "tspan",
  "textPath",
  "use",
  "marker",
  "mask",
  "pattern",
  "symbol",
  "defs",
  "clipPath",
  "linearGradient",
  "radialGradient",
  "stop",
  "filter",
]);

const isSvgElementAttribute = (node: EsTreeNodeOfType<"JSXAttribute">): boolean => {
  const openingElement = node.parent;
  return Boolean(
    openingElement &&
    isNodeOfType(openingElement, "JSXOpeningElement") &&
    isNodeOfType(openingElement.name, "JSXIdentifier") &&
    SVG_GEOMETRY_ELEMENT_NAMES.has(openingElement.name.name),
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

      for (const property of expression.properties ?? []) {
        const key = getStylePropertyKey(property);
        if (key !== "transition" && key !== "transitionProperty") continue;

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
