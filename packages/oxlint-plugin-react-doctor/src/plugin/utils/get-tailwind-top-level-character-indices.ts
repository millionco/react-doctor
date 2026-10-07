export const getTailwindTopLevelCharacterIndices = (
  value: string,
  predicate: (character: string) => boolean,
): number[] => {
  const characterIndices: number[] = [];
  let bracketDepth = 0;
  let parenthesisDepth = 0;
  let quote: '"' | "'" | null = null;
  let isEscaped = false;

  for (let characterIndex = 0; characterIndex < value.length; characterIndex += 1) {
    const character = value[characterIndex];
    if (isEscaped) {
      isEscaped = false;
      continue;
    }
    if (character === "\\") {
      isEscaped = true;
      continue;
    }
    if (quote) {
      if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === "[") bracketDepth += 1;
    if (character === "]") bracketDepth = Math.max(0, bracketDepth - 1);
    if (character === "(") parenthesisDepth += 1;
    if (character === ")") parenthesisDepth = Math.max(0, parenthesisDepth - 1);
    if (bracketDepth === 0 && parenthesisDepth === 0 && predicate(character)) {
      characterIndices.push(characterIndex);
    }
  }

  return characterIndices;
};
