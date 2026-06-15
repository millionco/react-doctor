import { defineRule } from "../../utils/define-rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { getStringFromClassNameAttr } from "./utils/get-string-from-class-name-attr.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

// Tailwind arbitrary transition-property utilities: `transition-[height]`,
// `transition-[width,opacity]`, `transition-[margin-top]`, etc.
const ARBITRARY_TRANSITION_PROPERTY = /transition-\[([^\]]+)\]/g;

// Layout-triggering properties: animating any of these forces the browser
// to recompute geometry every frame. (transform/opacity are not here — they
// are the cheap, compositor-only properties you should animate instead.)
const LAYOUT_PROPERTY =
  /\b(?:max-|min-)?(?:width|height)\b|\b(?:top|left|right|bottom|inset)\b|\bmargin(?:-(?:top|right|bottom|left|inline|block|inline-start|inline-end))?\b|\bpadding(?:-(?:top|right|bottom|left|inline|block|inline-start|inline-end))?\b/;

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
        const layoutMatch = animatedProperties.match(LAYOUT_PROPERTY);
        if (layoutMatch) {
          context.report({
            node,
            message: `Your users see janky animation because \`transition-[${animatedProperties}]\` animates "${layoutMatch[0]}", a layout property the browser recomputes every frame, so animate transform & opacity instead.`,
          });
        }
      }
    },
  }),
});
