import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { parseTailwindClassNameToken } from "../../utils/parse-tailwind-class-name-token.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { splitTailwindClassName } from "../../utils/split-tailwind-class-name.js";
import { getStringFromClassNameAttr } from "./utils/get-string-from-class-name-attr.js";
import { getEffectiveTailwindClassNameToken } from "./utils/get-effective-tailwind-class-name-token.js";

const HOVER_VARIANT_PATTERN = /^(?:(?:group|peer)-)?hover(?:\/[^:]+)?$/;
const IMAGE_TRANSFORM_PATTERN = /^-?(?:scale|rotate)-/;
const NEUTRAL_SCALE_PATTERN = /^scale(?:-[xyz])?-(?:100|none)$/;
const NEUTRAL_ROTATE_PATTERN = /^rotate(?:-[xyz])?-(?:0|none)$/;

const removeNegativeModifier = (utility: string): string =>
  utility.startsWith("-") ? utility.slice(1) : utility;

const getHoverImageTransform = (classNameValue: string): string | null => {
  const rawTokens = splitTailwindClassName(classNameValue);
  const variantScopes = new Map<string, string[]>();
  for (const rawToken of rawTokens) {
    const { utility, variants } = parseTailwindClassNameToken(rawToken);
    if (
      !IMAGE_TRANSFORM_PATTERN.test(utility) ||
      !variants.some((variant) => HOVER_VARIANT_PATTERN.test(variant))
    ) {
      continue;
    }
    variantScopes.set(JSON.stringify(variants), variants);
  }

  for (const variants of variantScopes.values()) {
    const effectiveScale = getEffectiveTailwindClassNameToken(
      rawTokens,
      (utility) => removeNegativeModifier(utility).startsWith("scale-"),
      variants,
    );
    if (
      effectiveScale &&
      (effectiveScale.startsWith("-") ||
        !NEUTRAL_SCALE_PATTERN.test(removeNegativeModifier(effectiveScale)))
    ) {
      return [...variants, effectiveScale].join(":");
    }
    const effectiveRotation = getEffectiveTailwindClassNameToken(
      rawTokens,
      (utility) => removeNegativeModifier(utility).startsWith("rotate-"),
      variants,
    );
    if (
      effectiveRotation &&
      !NEUTRAL_ROTATE_PATTERN.test(removeNegativeModifier(effectiveRotation))
    ) {
      return [...variants, effectiveRotation].join(":");
    }
  }
  return null;
};

export const noImageHoverTransform = defineRule({
  id: "no-image-hover-transform",
  title: "Image scales or rotates on hover",
  severity: "warn",
  defaultEnabled: false,
  tags: ["design", "test-noise"],
  recommendation:
    "Keep the image stable, or use a subtler hover response tied to an actual interaction affordance.",
  create: (context: RuleContext) => ({
    JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
      if (!isNodeOfType(node.name, "JSXIdentifier") || node.name.name !== "img") return;
      const classNameValue = getStringFromClassNameAttr(node);
      if (!classNameValue) return;
      const hoverTransform = getHoverImageTransform(classNameValue);
      if (!hoverTransform) return;
      context.report({
        node,
        message: `The ${hoverTransform} treatment makes the image itself shift under the pointer. Use a steadier hover affordance.`,
      });
    },
  }),
});
