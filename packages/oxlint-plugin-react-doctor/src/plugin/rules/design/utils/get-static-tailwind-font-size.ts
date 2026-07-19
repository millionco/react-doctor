import { ROOT_FONT_SIZE_PX, TAILWIND_TEXT_SIZE_PX } from "../../../constants/design.js";
import { getUnvariantClassNameTokens } from "../../../utils/get-unvariant-class-name-tokens.js";

const ARBITRARY_FONT_SIZE_PATTERN = /^text-\[([\d.]+)(px|rem)\]$/;

export const getStaticTailwindFontSize = (className: string | null): number | null => {
  if (!className) return null;
  let fontSizePx: number | null = null;
  for (const token of getUnvariantClassNameTokens(className)) {
    const standardSizePx = TAILWIND_TEXT_SIZE_PX.get(token);
    if (standardSizePx !== undefined) {
      fontSizePx = standardSizePx;
      continue;
    }
    const arbitrarySize = token.match(ARBITRARY_FONT_SIZE_PATTERN);
    if (!arbitrarySize) continue;
    const value = Number.parseFloat(arbitrarySize[1]);
    fontSizePx = arbitrarySize[2] === "rem" ? value * ROOT_FONT_SIZE_PX : value;
  }
  return fontSizePx;
};
