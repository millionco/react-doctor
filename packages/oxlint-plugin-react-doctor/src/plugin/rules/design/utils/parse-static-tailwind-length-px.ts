import { ROOT_FONT_SIZE_PX, TAILWIND_SPACING_UNIT_PX } from "../../../constants/design.js";

export const parseStaticTailwindLengthPx = (utility: string, prefix: string): number | null => {
  if (utility === `${prefix}-px`) return 1;
  const arbitraryMatch = utility.match(
    new RegExp(`^${prefix}-\\[(?:length:)?(\\d+(?:\\.\\d*)?|\\.\\d+)(px|rem)\\]$`, "i"),
  );
  if (arbitraryMatch) {
    const numericValue = Number.parseFloat(arbitraryMatch[1]);
    return arbitraryMatch[2].toLowerCase() === "rem"
      ? numericValue * ROOT_FONT_SIZE_PX
      : numericValue;
  }
  const scaleMatch = utility.match(new RegExp(`^${prefix}-(\\d+(?:\\.\\d*)?|\\.\\d+)$`));
  return scaleMatch ? Number.parseFloat(scaleMatch[1]) * TAILWIND_SPACING_UNIT_PX : null;
};
