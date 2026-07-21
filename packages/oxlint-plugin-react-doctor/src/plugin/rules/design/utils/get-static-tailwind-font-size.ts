import { getUnvariantClassNameTokensWithImportantModifiers } from "../../../utils/get-unvariant-class-name-tokens-with-important-modifiers.js";
import { getEffectiveTailwindClassNameToken } from "./get-effective-tailwind-class-name-token.js";
import { parseStaticTailwindFontSize } from "./parse-static-tailwind-font-size.js";

export const getStaticTailwindFontSize = (className: string | null): number | null => {
  if (!className) return null;
  const effectiveFontSize = getEffectiveTailwindClassNameToken(
    getUnvariantClassNameTokensWithImportantModifiers(className),
    (utility) => parseStaticTailwindFontSize(utility) !== null,
  );
  if (!effectiveFontSize) return null;
  return parseStaticTailwindFontSize(effectiveFontSize);
};
