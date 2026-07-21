import { getTailwindTopLevelCharacterIndices } from "./get-tailwind-top-level-character-indices.js";

export const splitTailwindClassName = (classNameValue: string): string[] => {
  const tokens: string[] = [];
  let tokenStartIndex = 0;

  for (const characterIndex of getTailwindTopLevelCharacterIndices(classNameValue, (character) =>
    /\s/.test(character),
  )) {
    const token = classNameValue.slice(tokenStartIndex, characterIndex);
    if (token) tokens.push(token);
    tokenStartIndex = characterIndex + 1;
  }

  const finalToken = classNameValue.slice(tokenStartIndex);
  if (finalToken) tokens.push(finalToken);
  return tokens;
};
