import { getUnvariantClassNameTokensWithImportantModifiers } from "../../../utils/get-unvariant-class-name-tokens-with-important-modifiers.js";
import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";
import {
  ROOT_FONT_SIZE_PX,
  TAILWIND_PADDING_AXIS_SPECIFICITY_RANK,
  TAILWIND_PADDING_SHORTHAND_SPECIFICITY_RANK,
  TAILWIND_PADDING_SIDE_SPECIFICITY_RANK,
  TAILWIND_SPACING_UNIT_PX,
} from "../../../constants/design.js";
import { MINIMUM_CARD_PADDING_SCALE } from "./constants.js";
import { getStringFromClassNameAttr } from "./get-string-from-class-name-attr.js";
import { getEffectiveTailwindClassNameToken } from "./get-effective-tailwind-class-name-token.js";
import {
  hasVisibleTailwindBackground,
  hasVisibleTailwindBoundary,
} from "./has-visible-tailwind-fill-or-edge.js";

const COMPLETE_ROUNDING_PATTERN = /^rounded(?:-(?:[2-9]xl|full|lg|md|sm|xl|xs|\[[^\]]+\]))?$/;
const PADDING_PATTERN = /^p[trblesxy]?-(px|[\d.]+|\[[\d.]+(?:px|rem)\])$/;
const PADDING_SIDES_BY_PREFIX = new Map([
  ["p", ["top", "right", "bottom", "left"]],
  ["px", ["right", "left"]],
  ["py", ["top", "bottom"]],
  ["pt", ["top"]],
  ["pr", ["right"]],
  ["pb", ["bottom"]],
  ["pl", ["left"]],
  ["ps", ["start"]],
  ["pe", ["end"]],
]);

interface EffectivePaddingState {
  isImportant: boolean;
  specificity: number;
  value: number | null;
}

const getPaddingValuePx = (token: string): number | null => {
  const match = token.match(PADDING_PATTERN);
  if (!match) return null;
  if (match[1] === "px") return 1;
  const numericValue = parseFloat(match[1].replace(/^\[|(?:px|rem)\]$/g, ""));
  if (match[1].endsWith("rem]")) return numericValue * ROOT_FONT_SIZE_PX;
  if (match[1].endsWith("px]")) return numericValue;
  return numericValue * TAILWIND_SPACING_UNIT_PX;
};

const getEffectivePaddingValues = (tokens: string[]): number[] => {
  const paddingBySide = new Map<string, EffectivePaddingState>();
  for (const markedToken of tokens) {
    const isImportant = markedToken.startsWith("!");
    const token = isImportant ? markedToken.slice(1) : markedToken;
    const prefix = token.slice(0, token.indexOf("-"));
    const paddingValue = getPaddingValuePx(token);
    if (paddingValue === null) continue;
    let specificity = TAILWIND_PADDING_SIDE_SPECIFICITY_RANK;
    if (prefix === "p") {
      specificity = TAILWIND_PADDING_SHORTHAND_SPECIFICITY_RANK;
    } else if (prefix === "px" || prefix === "py") {
      specificity = TAILWIND_PADDING_AXIS_SPECIFICITY_RANK;
    }
    for (const side of PADDING_SIDES_BY_PREFIX.get(prefix) ?? []) {
      const currentPadding = paddingBySide.get(side);
      if (
        (currentPadding?.isImportant && !isImportant) ||
        (currentPadding?.isImportant === isImportant && currentPadding.specificity > specificity)
      ) {
        continue;
      }
      if (
        currentPadding?.isImportant === isImportant &&
        currentPadding.specificity === specificity
      ) {
        if (currentPadding.value !== paddingValue) {
          paddingBySide.set(side, { ...currentPadding, value: null });
        }
        continue;
      }
      paddingBySide.set(side, { isImportant, specificity, value: paddingValue });
    }
  }
  return [...paddingBySide.values()].flatMap((padding) =>
    padding.value === null ? [] : [padding.value],
  );
};

export const isTailwindCardSurface = (node: EsTreeNodeOfType<"JSXOpeningElement">): boolean => {
  const classNameValue = getStringFromClassNameAttr(node);
  if (!classNameValue) return false;
  const tokens = getUnvariantClassNameTokensWithImportantModifiers(classNameValue);
  const effectiveRounding = getEffectiveTailwindClassNameToken(
    tokens,
    (token) => token === "rounded-none" || COMPLETE_ROUNDING_PATTERN.test(token),
  );
  const hasRounding = Boolean(effectiveRounding && effectiveRounding !== "rounded-none");
  const paddingValues = getEffectivePaddingValues(tokens);
  const hasInterior =
    paddingValues.some((padding) => padding > 0) || hasVisibleTailwindBackground(tokens);
  return hasRounding && hasVisibleTailwindBoundary(tokens) && hasInterior;
};

export const isTailwindPaddedCardSurface = (
  node: EsTreeNodeOfType<"JSXOpeningElement">,
): boolean => {
  const classNameValue = getStringFromClassNameAttr(node);
  if (!classNameValue) return false;
  const tokens = getUnvariantClassNameTokensWithImportantModifiers(classNameValue);
  const effectiveRounding = getEffectiveTailwindClassNameToken(
    tokens,
    (token) => token === "rounded-none" || COMPLETE_ROUNDING_PATTERN.test(token),
  );
  return (
    effectiveRounding !== "rounded-full" &&
    isTailwindCardSurface(node) &&
    getEffectivePaddingValues(tokens).some(
      (padding) => padding >= MINIMUM_CARD_PADDING_SCALE * TAILWIND_SPACING_UNIT_PX,
    )
  );
};
