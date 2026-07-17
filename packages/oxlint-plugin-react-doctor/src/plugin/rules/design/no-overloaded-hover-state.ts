import { OVERLOADED_HOVER_PROPERTY_MIN_COUNT } from "../../constants/design.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getTailwindVariantUtilities } from "../../utils/get-tailwind-variant-utilities.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { getStringFromClassNameAttr } from "./utils/get-string-from-class-name-attr.js";

const getHoverPropertyGroup = (utility: string): string | null => {
  if (/^(?:-)?(?:translate|scale|rotate|skew)-/.test(utility)) return "transform";
  if (/^(?:bg|text|border|fill|stroke)-/.test(utility)) return "color";
  if (/^shadow(?:-|$)/.test(utility)) return "shadow";
  if (/^opacity-/.test(utility)) return "opacity";
  if (/^(?:blur|brightness|contrast|grayscale|hue-rotate|invert|saturate|sepia)-/.test(utility)) {
    return "filter";
  }
  return null;
};

export const noOverloadedHoverState = defineRule({
  id: "no-overloaded-hover-state",
  title: "Hover state stacks too many effects",
  severity: "warn",
  defaultEnabled: false,
  tags: ["design", "test-noise"],
  recommendation:
    "Use one restrained hover idea, such as a color shift or a small shadow change, instead of stacking motion, color, and depth effects.",
  create: (context: RuleContext) => ({
    JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
      const classNameValue = getStringFromClassNameAttr(node);
      if (!classNameValue) return;
      const propertyGroups = new Set(
        getTailwindVariantUtilities(classNameValue, "hover")
          .map(getHoverPropertyGroup)
          .filter((group): group is string => group !== null),
      );
      if (propertyGroups.size < OVERLOADED_HOVER_PROPERTY_MIN_COUNT) return;
      context.report({
        node,
        message: `This hover state combines ${[...propertyGroups].join(", ")}. Keep one clear feedback mechanism so the component feels stable.`,
      });
    },
  }),
});
