import { LAYOUT_TRANSITION_PROPERTIES } from "../../constants/style.js";
import { defineRule } from "../../utils/define-rule.js";
import { getClassNameTokens } from "../../utils/get-class-name-tokens.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { getStringFromClassNameAttr } from "./utils/get-string-from-class-name-attr.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isSvgLayoutTransitionExemptElementName } from "./utils/is-svg-layout-transition-exempt-element-name.js";

// Tailwind arbitrary transition-property utilities: `transition-[height]`,
// `transition-[width,opacity]`, `transition-[margin-top]`, etc.
const ARBITRARY_TRANSITION_PROPERTY = /^transition-\[([^\]]+)\]$/;

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
      if (
        isNodeOfType(node.name, "JSXIdentifier") &&
        isSvgLayoutTransitionExemptElementName(node.name.name)
      ) {
        return;
      }

      const classNameValue = getStringFromClassNameAttr(node);
      if (!classNameValue) return;

      for (const token of getClassNameTokens(classNameValue)) {
        const transitionMatch = token.match(ARBITRARY_TRANSITION_PROPERTY);
        if (!transitionMatch) continue;
        const animatedProperties = transitionMatch[1];
        const layoutProperty = animatedProperties
          .split(",")
          .map((property) => property.trim())
          .find((property) => LAYOUT_TRANSITION_PROPERTIES.has(property));
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
