import { doesTailwindVariantScopeCover } from "./does-tailwind-variant-scope-cover.js";
import { getHighestPriorityTailwindClassNameTokens } from "./get-highest-priority-tailwind-class-name-tokens.js";
import type { TailwindClassNameToken } from "./parse-tailwind-class-name-token.js";

export const resolveTailwindBooleanPropertyState = (
  parsedTokens: ReadonlyArray<TailwindClassNameToken>,
  targetVariantScope: ReadonlyArray<string>,
  getPropertyState: (utility: string) => boolean | null,
): boolean | null => {
  const highestPriorityTokens = getHighestPriorityTailwindClassNameTokens(
    parsedTokens,
    (parsedToken) =>
      getPropertyState(parsedToken.utility) !== null &&
      doesTailwindVariantScopeCover(parsedToken.variants, targetVariantScope),
  );
  const states = new Set(
    highestPriorityTokens.map((parsedToken) => getPropertyState(parsedToken.utility)),
  );
  if (states.size !== 1) return null;
  return states.values().next().value ?? null;
};
