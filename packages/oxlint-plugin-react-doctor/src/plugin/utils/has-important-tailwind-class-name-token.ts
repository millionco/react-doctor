import { doesTailwindVariantScopeCover } from "./does-tailwind-variant-scope-cover.js";
import { getHighestPriorityTailwindClassNameTokens } from "./get-highest-priority-tailwind-class-name-tokens.js";
import type { TailwindClassNameToken } from "./parse-tailwind-class-name-token.js";

export const hasImportantTailwindClassNameToken = (
  parsedTokens: ReadonlyArray<TailwindClassNameToken>,
  targetVariantScope: ReadonlyArray<string>,
  predicate: (utility: string) => boolean,
): boolean =>
  getHighestPriorityTailwindClassNameTokens(
    parsedTokens,
    (parsedToken) =>
      predicate(parsedToken.utility) &&
      doesTailwindVariantScopeCover(parsedToken.variants, targetVariantScope),
  ).some((parsedToken) => parsedToken.isImportant);
