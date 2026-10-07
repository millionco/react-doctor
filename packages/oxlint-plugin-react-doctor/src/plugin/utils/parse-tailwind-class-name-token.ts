import { getTailwindTopLevelCharacterIndices } from "./get-tailwind-top-level-character-indices.js";

export interface TailwindClassNameToken {
  isImportant: boolean;
  utility: string;
  variants: string[];
}

const isCharacterEscaped = (value: string, characterIndex: number): boolean => {
  let backslashCount = 0;
  for (
    let precedingIndex = characterIndex - 1;
    precedingIndex >= 0 && value[precedingIndex] === "\\";
    precedingIndex -= 1
  ) {
    backslashCount += 1;
  }
  return backslashCount % 2 === 1;
};

export const parseTailwindClassNameToken = (rawToken: string): TailwindClassNameToken => {
  const variants: string[] = [];
  let segmentStartIndex = 0;

  for (const characterIndex of getTailwindTopLevelCharacterIndices(
    rawToken,
    (character) => character === ":",
  )) {
    variants.push(rawToken.slice(segmentStartIndex, characterIndex));
    segmentStartIndex = characterIndex + 1;
  }

  let utility = rawToken.slice(segmentStartIndex);
  const hasTrailingImportantModifier =
    utility.endsWith("!") && !isCharacterEscaped(utility, utility.length - 1);
  const isImportant = utility.startsWith("!") || hasTrailingImportantModifier;
  if (utility.startsWith("!")) utility = utility.slice(1);
  if (hasTrailingImportantModifier) utility = utility.slice(0, -1);

  return { isImportant, utility, variants };
};
