import { resolveEffectiveTailwindClassNameToken } from "./resolve-effective-tailwind-class-name-token.js";

export const getEffectiveTailwindClassNameToken = (
  tokens: string[],
  predicate: (utility: string) => boolean,
  targetVariantScope?: ReadonlyArray<string>,
): string | null => {
  return resolveEffectiveTailwindClassNameToken(tokens, predicate, targetVariantScope).utility;
};
