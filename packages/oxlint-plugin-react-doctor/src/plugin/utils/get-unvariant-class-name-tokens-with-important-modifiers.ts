import { parseTailwindClassNameToken } from "./parse-tailwind-class-name-token.js";
import { splitTailwindClassName } from "./split-tailwind-class-name.js";

export const getUnvariantClassNameTokensWithImportantModifiers = (
  classNameValue: string,
): string[] =>
  splitTailwindClassName(classNameValue)
    .map(parseTailwindClassNameToken)
    .filter((token) => token.variants.length === 0)
    .map((token) => (token.isImportant ? `!${token.utility}` : token.utility));
