export const getClassNameTokens = (classNameValue: string): string[] =>
  classNameValue
    .split(/\s+/)
    .filter((token) => token.length > 0)
    .map((token) => {
      let arbitraryValueDepth = 0;
      let variantSeparatorIndex = -1;

      for (let characterIndex = 0; characterIndex < token.length; characterIndex += 1) {
        const character = token[characterIndex];
        const isEscaped = token[characterIndex - 1] === "\\";
        if (isEscaped) continue;
        if (character === "[") arbitraryValueDepth += 1;
        if (character === "]") arbitraryValueDepth = Math.max(0, arbitraryValueDepth - 1);
        if (character === ":" && arbitraryValueDepth === 0) {
          variantSeparatorIndex = characterIndex;
        }
      }

      let utility = token.slice(variantSeparatorIndex + 1);
      if (utility.startsWith("!")) utility = utility.slice(1);
      if (utility.endsWith("!")) utility = utility.slice(0, -1);
      return utility;
    });
