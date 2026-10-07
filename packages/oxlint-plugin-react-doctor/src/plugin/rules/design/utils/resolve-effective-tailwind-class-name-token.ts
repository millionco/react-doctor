import { doesTailwindVariantScopeCover } from "../../../utils/does-tailwind-variant-scope-cover.js";
import { getHighestPriorityTailwindClassNameTokens } from "../../../utils/get-highest-priority-tailwind-class-name-tokens.js";
import { parseTailwindClassNameToken } from "../../../utils/parse-tailwind-class-name-token.js";

export interface EffectiveTailwindClassNameTokenResolution {
  isAmbiguous: boolean;
  isImportant: boolean;
  utility: string | null;
}

export const resolveEffectiveTailwindClassNameToken = (
  tokens: string[],
  predicate: (utility: string) => boolean,
  targetVariantScope?: ReadonlyArray<string>,
): EffectiveTailwindClassNameTokenResolution => {
  const highestPriorityTokens = getHighestPriorityTailwindClassNameTokens(
    tokens.map(parseTailwindClassNameToken),
    (parsedToken) =>
      predicate(parsedToken.utility) &&
      (targetVariantScope
        ? doesTailwindVariantScopeCover(parsedToken.variants, targetVariantScope)
        : parsedToken.variants.length === 0),
  );
  const highestPriorityUtilities = new Set(
    highestPriorityTokens.map((parsedToken) => parsedToken.utility),
  );
  if (highestPriorityUtilities.size !== 1) {
    return {
      isAmbiguous: highestPriorityUtilities.size > 1,
      isImportant: false,
      utility: null,
    };
  }
  return {
    isAmbiguous: false,
    isImportant: highestPriorityTokens[0]?.isImportant ?? false,
    utility: highestPriorityUtilities.values().next().value ?? null,
  };
};
