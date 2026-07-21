import { defineRule } from "../../utils/define-rule.js";
import { doesTailwindVariantScopeCover } from "../../utils/does-tailwind-variant-scope-cover.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getHighestPriorityTailwindClassNameTokens } from "../../utils/get-highest-priority-tailwind-class-name-tokens.js";
import { getTailwindArbitraryUtilityValue } from "../../utils/get-tailwind-arbitrary-utility-value.js";
import { getTailwindNonMotionVariantScope } from "../../utils/get-tailwind-non-motion-variant-scope.js";
import { hasJsxSpreadAttribute } from "../../utils/has-jsx-spread-attribute.js";
import { isTailwindMotionSafeVariant } from "../../utils/is-tailwind-motion-safe-variant.js";
import { isTailwindReducedMotionVariant } from "../../utils/is-tailwind-reduced-motion-variant.js";
import { normalizeTailwindArbitraryUtilityValue } from "../../utils/normalize-tailwind-arbitrary-utility-value.js";
import { parseTailwindClassNameToken } from "../../utils/parse-tailwind-class-name-token.js";
import type { TailwindClassNameToken } from "../../utils/parse-tailwind-class-name-token.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { splitTailwindClassName } from "../../utils/split-tailwind-class-name.js";
import { getStringFromClassNameAttr } from "../design/utils/get-string-from-class-name-attr.js";

const SPATIAL_REDUCED_MOTION_ANIMATION_UTILITIES = new Set([
  "animate-bounce",
  "animate-ping",
  "animate-spin",
]);

const isAnimationUtility = (utility: string): boolean => {
  if (utility === "animate-none") return false;
  const arbitraryAnimationValue = getTailwindArbitraryUtilityValue(utility, "animate-[");
  if (
    arbitraryAnimationValue !== null &&
    normalizeTailwindArbitraryUtilityValue(arbitraryAnimationValue).trim().toLowerCase() === "none"
  ) {
    return false;
  }
  return utility.startsWith("animate-") || utility === "animate";
};

const setsAnimationProperty = (utility: string): boolean =>
  utility === "animate-none" || isAnimationUtility(utility);

const getEffectiveToken = (
  parsedTokens: ReadonlyArray<TailwindClassNameToken>,
  targetVariantScope: ReadonlyArray<string>,
  matchesProperty: (utility: string) => boolean,
): TailwindClassNameToken | null | undefined => {
  const effectiveTokens = getHighestPriorityTailwindClassNameTokens(
    parsedTokens,
    (parsedToken) =>
      matchesProperty(parsedToken.utility) &&
      doesTailwindVariantScopeCover(parsedToken.variants, targetVariantScope),
  );
  if (effectiveTokens.length === 0) return undefined;
  const effectiveUtility = effectiveTokens[0]?.utility;
  if (!effectiveUtility || effectiveTokens.some((token) => token.utility !== effectiveUtility)) {
    return null;
  }
  return effectiveTokens[0] ?? null;
};

const isEffectiveAlternative = (
  parsedTokens: ReadonlyArray<TailwindClassNameToken>,
  candidate: TailwindClassNameToken,
  animationVariantScope: ReadonlyArray<string>,
): boolean | null => {
  const candidateVariantScope = getTailwindNonMotionVariantScope(candidate.variants);
  const isAnimationAlternative = setsAnimationProperty(candidate.utility);
  if (!doesTailwindVariantScopeCover(candidateVariantScope, animationVariantScope)) {
    return false;
  }

  let matchesProperty: (utility: string) => boolean;
  if (isAnimationAlternative) {
    matchesProperty = setsAnimationProperty;
  } else if (candidate.utility === "hidden") {
    matchesProperty = (utility: string): boolean =>
      utility === "hidden" ||
      ["block", "flex", "grid", "inline", "inline-block", "inline-flex", "inline-grid"].includes(
        utility,
      );
  } else {
    matchesProperty = (utility: string): boolean =>
      utility === "visible" || utility === "invisible";
  }
  const effectiveCandidate = getEffectiveToken(parsedTokens, candidate.variants, matchesProperty);
  if (effectiveCandidate === null) return null;
  if (!effectiveCandidate || effectiveCandidate.utility !== candidate.utility) return false;

  for (const otherToken of parsedTokens) {
    if (otherToken.utility === candidate.utility || !matchesProperty(otherToken.utility)) continue;
    if (!otherToken.variants.some(isTailwindReducedMotionVariant)) continue;
    const otherVariantScope = getTailwindNonMotionVariantScope(otherToken.variants);
    if (!doesTailwindVariantScopeCover(otherVariantScope, animationVariantScope)) continue;
    if (otherToken.isImportant && !candidate.isImportant) return false;
    if (otherToken.isImportant !== candidate.isImportant) continue;
    if (otherVariantScope.length > candidateVariantScope.length) return false;
    if (otherVariantScope.length === candidateVariantScope.length) return null;
  }
  return true;
};

const hasUnsafeAnimation = (className: string): boolean => {
  const parsedTokens = splitTailwindClassName(className).map(parseTailwindClassNameToken);

  return parsedTokens.some((animationToken) => {
    const { isImportant, utility, variants } = animationToken;
    if (!isAnimationUtility(utility) || variants.some(isTailwindMotionSafeVariant)) return false;
    const effectiveAnimationToken = getEffectiveToken(
      parsedTokens,
      variants,
      setsAnimationProperty,
    );
    if (
      !effectiveAnimationToken ||
      effectiveAnimationToken.utility !== utility ||
      effectiveAnimationToken.isImportant !== isImportant
    ) {
      return false;
    }
    if (
      variants.some(isTailwindReducedMotionVariant) &&
      !SPATIAL_REDUCED_MOTION_ANIMATION_UTILITIES.has(utility)
    ) {
      return false;
    }

    const animationVariantScope = getTailwindNonMotionVariantScope(variants);
    let hasUnknownReducedMotionAlternative = false;
    const hasReducedMotionAlternative = parsedTokens.some((candidate) => {
      const isSafeAnimationAlternative =
        candidate.utility === "animate-none" ||
        (isAnimationUtility(candidate.utility) &&
          !SPATIAL_REDUCED_MOTION_ANIMATION_UTILITIES.has(candidate.utility));
      const isVisibilityAlternative =
        candidate.utility === "hidden" || candidate.utility === "invisible";
      if (!candidate.variants.some(isTailwindReducedMotionVariant)) return false;
      if (!isSafeAnimationAlternative && !isVisibilityAlternative) return false;
      if (isSafeAnimationAlternative && isImportant && !candidate.isImportant) {
        return false;
      }
      const alternativeEffectiveness = isEffectiveAlternative(
        parsedTokens,
        candidate,
        animationVariantScope,
      );
      if (alternativeEffectiveness === null) hasUnknownReducedMotionAlternative = true;
      return alternativeEffectiveness === true;
    });
    return !hasReducedMotionAlternative && !hasUnknownReducedMotionAlternative;
  });
};

export const noUngatedTailwindAnimation = defineRule({
  id: "no-ungated-tailwind-animation",
  title: "Tailwind animation ignores reduced motion",
  severity: "warn",
  category: "Accessibility",
  defaultEnabled: false,
  requires: ["tailwind"],
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
