import { parseTailwindClassNameToken } from "./parse-tailwind-class-name-token.js";
import { splitTailwindClassName } from "./split-tailwind-class-name.js";

export const getTailwindVariantUtilities = (
  classNameValue: string,
  variantName: string,
): string[] =>
  splitTailwindClassName(classNameValue)
    .map(parseTailwindClassNameToken)
    .filter((token) => token.variants.includes(variantName))
    .map((token) => token.utility);
