import { defineRule } from "../../utils/define-rule.js";
import { doesTailwindVariantScopeCover } from "../../utils/does-tailwind-variant-scope-cover.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { hasCapabilityOrUnspecified } from "../../utils/get-react-doctor-setting.js";
import { getTailwindNonMotionVariantScope } from "../../utils/get-tailwind-non-motion-variant-scope.js";
import { hasJsxSpreadAttribute } from "../../utils/has-jsx-spread-attribute.js";
import { hasImportantTailwindClassNameToken } from "../../utils/has-important-tailwind-class-name-token.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isTailwindMotionSafeVariant } from "../../utils/is-tailwind-motion-safe-variant.js";
import { isTailwindReducedMotionVariant } from "../../utils/is-tailwind-reduced-motion-variant.js";
import { parseTailwindClassNameToken } from "../../utils/parse-tailwind-class-name-token.js";
import type { TailwindClassNameToken } from "../../utils/parse-tailwind-class-name-token.js";
import { resolveTailwindBooleanPropertyState } from "../../utils/resolve-tailwind-boolean-property-state.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { splitTailwindClassName } from "../../utils/split-tailwind-class-name.js";
import { getEffectiveStyleProperty } from "./utils/get-effective-style-property.js";
import { getInlineStyleExpression } from "./utils/get-inline-style-expression.js";
import { getStringFromClassNameAttr } from "./utils/get-string-from-class-name-attr.js";
import { getStylePropertyStringValue } from "./utils/get-style-property-string-value.js";

const getScrollBehaviorState = (utility: string): boolean | null => {
  if (utility === "scroll-smooth") return true;
  if (utility === "scroll-auto") return false;
  return null;
};

const isEffectiveReducedMotionFallback = (
  parsedTokens: ReadonlyArray<TailwindClassNameToken>,
  candidate: TailwindClassNameToken,
  smoothToken: TailwindClassNameToken,
): boolean | null => {
  const candidateVariantScope = getTailwindNonMotionVariantScope(candidate.variants);
  const smoothVariantScope = getTailwindNonMotionVariantScope(smoothToken.variants);
  if (!doesTailwindVariantScopeCover(candidateVariantScope, smoothVariantScope)) return false;
  if (smoothToken.isImportant && !candidate.isImportant) return false;

  const effectiveCandidateState = resolveTailwindBooleanPropertyState(
    parsedTokens,
    candidate.variants,
    getScrollBehaviorState,
  );
  if (effectiveCandidateState === null) return null;
  if (effectiveCandidateState) return false;

  for (const otherToken of parsedTokens) {
    if (otherToken.utility !== "scroll-smooth") continue;
    if (!otherToken.variants.some(isTailwindReducedMotionVariant)) continue;
    const otherVariantScope = getTailwindNonMotionVariantScope(otherToken.variants);
    if (!doesTailwindVariantScopeCover(otherVariantScope, smoothVariantScope)) continue;
    if (otherToken.isImportant && !candidate.isImportant) return false;
    if (otherToken.isImportant !== candidate.isImportant) continue;
    if (otherVariantScope.length > candidateVariantScope.length) return false;
    if (otherVariantScope.length === candidateVariantScope.length) return null;
  }
  return true;
};

const hasUnsafeSmoothScrollClass = (className: string): boolean => {
  const parsedTokens = splitTailwindClassName(className).map(parseTailwindClassNameToken);
  return parsedTokens.some((smoothToken) => {
    if (smoothToken.utility !== "scroll-smooth") return false;
    if (smoothToken.variants.some(isTailwindMotionSafeVariant)) return false;
    const effectiveSmoothState = resolveTailwindBooleanPropertyState(
      parsedTokens,
      smoothToken.variants,
      getScrollBehaviorState,
    );
    if (effectiveSmoothState !== true) {
      return false;
    }

    let hasUnknownFallback = false;
    const hasEffectiveFallback = parsedTokens.some((candidate) => {
      if (candidate.utility !== "scroll-auto") return false;
      if (!candidate.variants.some(isTailwindReducedMotionVariant)) return false;
      const fallbackEffectiveness = isEffectiveReducedMotionFallback(
        parsedTokens,
        candidate,
        smoothToken,
      );
      if (fallbackEffectiveness === null) hasUnknownFallback = true;
      return fallbackEffectiveness === true;
    });
    return !hasEffectiveFallback && !hasUnknownFallback;
  });
};

const doesImportantTailwindClassPreventInlineSmoothScroll = (className: string): boolean => {
  const parsedTokens = splitTailwindClassName(className).map(parseTailwindClassNameToken);
  if (
    hasImportantTailwindClassNameToken(
      parsedTokens,
      [],
      (utility) => getScrollBehaviorState(utility) !== null,
    ) &&
    resolveTailwindBooleanPropertyState(parsedTokens, [], getScrollBehaviorState) === false
  ) {
    return true;
  }
  const inlineSmoothToken: TailwindClassNameToken = {
    isImportant: false,
    utility: "scroll-smooth",
    variants: [],
  };
  return parsedTokens.some(
    (candidate) =>
      candidate.isImportant &&
      candidate.utility === "scroll-auto" &&
      candidate.variants.some(isTailwindReducedMotionVariant) &&
      isEffectiveReducedMotionFallback(parsedTokens, candidate, inlineSmoothToken) === true,
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
        const className = getStringFromClassNameAttr(openingElement);
        if (
          className &&
          hasCapabilityOrUnspecified(context.settings, "tailwind") &&
          doesImportantTailwindClassPreventInlineSmoothScroll(className)
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
        if (!hasCapabilityOrUnspecified(context.settings, "tailwind")) return;
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
