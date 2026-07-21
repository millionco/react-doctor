import { ROOT_FONT_SIZE_PX, TAILWIND_TEXT_SIZE_PX } from "../../../constants/design.js";

const ARBITRARY_FONT_SIZE_PATTERN =
  /^text-\[(?:length:)?((?:\d+(?:\.\d*)?|\.\d+))(px|rem)\](?:\/.+)?$/i;

export const parseStaticTailwindFontSize = (utility: string): number | null => {
  const standardSizePx = TAILWIND_TEXT_SIZE_PX.get(utility.split("/")[0]);
  if (standardSizePx !== undefined) return standardSizePx;
  const arbitrarySize = utility.match(ARBITRARY_FONT_SIZE_PATTERN);
  if (!arbitrarySize) return null;
  const value = Number.parseFloat(arbitrarySize[1]);
  return arbitrarySize[2].toLowerCase() === "rem" ? value * ROOT_FONT_SIZE_PX : value;
};
