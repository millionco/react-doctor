import { getClassNameTokens } from "./get-class-name-tokens.js";

export const getUnvariantClassNameTokens = (classNameValue: string): string[] =>
  classNameValue
    .split(/\s+/)
    .filter((token) => {
      let arbitraryValueDepth = 0;
      for (let characterIndex = 0; characterIndex < token.length; characterIndex += 1) {
        const character = token[characterIndex];
        if (token[characterIndex - 1] === "\\") continue;
        if (character === "[") arbitraryValueDepth += 1;
        if (character === "]") arbitraryValueDepth = Math.max(0, arbitraryValueDepth - 1);
        if (character === ":" && arbitraryValueDepth === 0) return false;
      }
      return true;
    })
    .flatMap(getClassNameTokens);
