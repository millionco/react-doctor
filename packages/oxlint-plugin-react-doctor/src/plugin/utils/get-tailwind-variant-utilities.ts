import { getClassNameTokens } from "./get-class-name-tokens.js";

const hasTailwindVariant = (token: string, variantName: string): boolean => {
  let arbitraryValueDepth = 0;
  let variantStartIndex = 0;
  for (let characterIndex = 0; characterIndex < token.length; characterIndex += 1) {
    const character = token[characterIndex];
    if (token[characterIndex - 1] === "\\") continue;
    if (character === "[") arbitraryValueDepth += 1;
    if (character === "]") arbitraryValueDepth = Math.max(0, arbitraryValueDepth - 1);
    if (character !== ":" || arbitraryValueDepth !== 0) continue;
    if (token.slice(variantStartIndex, characterIndex) === variantName) return true;
    variantStartIndex = characterIndex + 1;
  }
  return false;
};

export const getTailwindVariantUtilities = (
  classNameValue: string,
  variantName: string,
): string[] =>
  classNameValue
    .split(/\s+/)
    .filter((token) => hasTailwindVariant(token, variantName))
    .flatMap(getClassNameTokens);
