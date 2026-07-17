import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { hasJsxSpreadAttribute } from "../../utils/has-jsx-spread-attribute.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { getStringFromClassNameAttr } from "../design/utils/get-string-from-class-name-attr.js";

const isAnimationUtility = (utility: string): boolean =>
  utility !== "animate-none" && (utility.startsWith("animate-") || utility === "animate");

const hasUnsafeAnimation = (className: string): boolean => {
  const tokens = className.split(/\s+/).filter(Boolean);
  const hasReducedMotionOverride = tokens.some((token) => {
    const segments = token.split(":");
    return segments.includes("motion-reduce") && segments.at(-1)?.startsWith("animate-");
  });
  if (hasReducedMotionOverride) return false;
  return tokens.some((token) => {
    const segments = token.split(":");
    const utility = segments.at(-1) ?? "";
    return isAnimationUtility(utility) && !segments.includes("motion-safe");
  });
};

export const noUngatedTailwindAnimation = defineRule({
  id: "no-ungated-tailwind-animation",
  title: "Tailwind animation ignores reduced motion",
  severity: "warn",
  category: "Accessibility",
  defaultEnabled: false,
  recommendation:
    "Gate motion with motion-safe or provide a motion-reduce animation override that preserves the same information without spatial movement.",
  create: (context: RuleContext) => ({
    JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
      if (hasJsxSpreadAttribute(node.attributes)) return;
      const className = getStringFromClassNameAttr(node);
      if (!className || !hasUnsafeAnimation(className)) return;
      context.report({
        node,
        message:
          "This Tailwind animation runs even when the user requests reduced motion. Gate it with motion-safe or add a motion-reduce animation alternative.",
      });
    },
  }),
});
