import { normalizeTailwindArbitraryUtilityValue } from "../../../utils/normalize-tailwind-arbitrary-utility-value.js";
import { resolveEffectiveTailwindClassNameToken } from "./resolve-effective-tailwind-class-name-token.js";

export interface StaticTailwindBackgroundImage {
  isAmbiguous: boolean;
  isImportant: boolean;
  value: string | null;
}

const TAILWIND_BACKGROUND_IMAGE_UTILITY_PATTERN =
  /^(?:bg-none|bg-\[(?:image:[\s\S]+|(?:radial-gradient|repeating-radial-gradient|linear-gradient|repeating-linear-gradient|conic-gradient|repeating-conic-gradient|url)\([\s\S]+\))\]|\[(?:background|background-image):[\s\S]+\])$/i;

export const getStaticTailwindBackgroundImage = (
  tokens: string[],
): StaticTailwindBackgroundImage => {
  const resolution = resolveEffectiveTailwindClassNameToken(
    tokens,
    (utility) => TAILWIND_BACKGROUND_IMAGE_UTILITY_PATTERN.test(utility),
    [],
  );
  const utility = resolution.utility;
  if (!utility || utility === "bg-none") {
    return {
      isAmbiguous: resolution.isAmbiguous,
      isImportant: resolution.isImportant,
      value: null,
    };
  }
  let arbitraryValue: string | null = null;
  if (utility.startsWith("bg-[") && utility.endsWith("]")) {
    arbitraryValue = utility.slice(4, -1).replace(/^image:/i, "");
  } else {
    const propertyMatch = utility.match(/^\[(?:background|background-image):([\s\S]+)\]$/i);
    arbitraryValue = propertyMatch?.[1] ?? null;
  }
  return {
    isAmbiguous: resolution.isAmbiguous,
    isImportant: resolution.isImportant,
    value: arbitraryValue ? normalizeTailwindArbitraryUtilityValue(arbitraryValue) : null,
  };
};
