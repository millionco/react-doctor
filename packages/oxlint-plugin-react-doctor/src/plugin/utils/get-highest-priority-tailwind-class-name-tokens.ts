import type { TailwindClassNameToken } from "./parse-tailwind-class-name-token.js";

export const getHighestPriorityTailwindClassNameTokens = (
  parsedTokens: ReadonlyArray<TailwindClassNameToken>,
  isApplicable: (parsedToken: TailwindClassNameToken) => boolean,
): TailwindClassNameToken[] => {
  const applicableTokens = parsedTokens.filter(isApplicable);
  const hasImportantToken = applicableTokens.some((parsedToken) => parsedToken.isImportant);
  const highestImportanceTokens = hasImportantToken
    ? applicableTokens.filter((parsedToken) => parsedToken.isImportant)
    : applicableTokens;
  const mostSpecificScopeLength = Math.max(
    -1,
    ...highestImportanceTokens.map((parsedToken) => parsedToken.variants.length),
  );
  return highestImportanceTokens.filter(
    (parsedToken) => parsedToken.variants.length === mostSpecificScopeLength,
  );
};
