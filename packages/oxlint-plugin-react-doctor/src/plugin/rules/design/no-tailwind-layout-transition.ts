import { defineRule } from "../../utils/define-rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { getStringFromClassNameAttr } from "./utils/get-string-from-class-name-attr.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

// Tailwind arbitrary transition-property utilities: `transition-[height]`,
// `transition-[width,opacity]`, `transition-[margin-top]`, etc.
const ARBITRARY_TRANSITION_PROPERTY = /transition-\[([^\]]+)\]/g;

// Layout-triggering properties: animating any of these forces the browser to
// recompute geometry every frame. Matched as EXACT property names (not
// substrings) so SVG `stroke-width` / `border-width` — which contain "width"
// but are not HTML layout — are not falsely flagged. transform/opacity are
// absent on purpose: they are the cheap, compositor-only properties to use.
const LAYOUT_PROPERTIES = new Set([
  "width",
  "height",
  "min-width",
  "max-width",
  "min-height",
  "max-height",
  "top",
  "left",
  "right",
  "bottom",
  "inset",
  "inset-block",
  "inset-inline",
  "margin",
  "margin-top",
  "margin-right",
  "margin-bottom",
  "margin-left",
  "margin-block",
  "margin-inline",
  "padding",
  "padding-top",
  "padding-right",
  "padding-bottom",
  "padding-left",
  "padding-block",
  "padding-inline",
]);

export const noTailwindLayoutTransition = defineRule({
  id: "no-tailwind-layout-transition",
  title: "Animating a layout property",
  tags: ["design", "test-noise"],
  severity: "warn",
  category: "Performance",
  recommendation:
    "Animate `transform` and `opacity` instead, since they skip layout and run on the compositor. For height, animate `grid-template-rows` from `0fr` to `1fr`.",
  create: (context: RuleContext) => ({
    JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
      const classNameValue = getStringFromClassNameAttr(node);
      if (!classNameValue) return;

      for (const transitionMatch of classNameValue.matchAll(ARBITRARY_TRANSITION_PROPERTY)) {
        const animatedProperties = transitionMatch[1];
        const layoutProperty = animatedProperties
          .split(",")
          .map((property) => property.trim())
          .find((property) => LAYOUT_PROPERTIES.has(property));
        if (layoutProperty) {
          context.report({
            node,
            message: `Your users see janky animation because \`transition-[${animatedProperties}]\` animates "${layoutProperty}", a layout property the browser recomputes every frame, so animate transform & opacity instead.`,
          });
        }
      }
    },
  }),
});
