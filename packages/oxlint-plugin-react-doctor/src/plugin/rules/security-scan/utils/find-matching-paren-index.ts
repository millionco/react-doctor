// Index of the `)` that closes the call whose opening `(` is at
// `openParenIndex`, ignoring parentheses inside string/template literals.
// Returns -1 if the parentheses never balance (truncated/odd source).
export const findMatchingParenIndex = (content: string, openParenIndex: number): number => {
  let depth = 0;
  let stringDelimiter: string | null = null;
  for (let index = openParenIndex; index < content.length; index += 1) {
    const character = content[index];
    if (stringDelimiter !== null) {
      if (character === "\\") {
        index += 1;
      } else if (character === stringDelimiter) {
        stringDelimiter = null;
      }
      continue;
    }
    if (character === '"' || character === "'" || character === "`") {
      stringDelimiter = character;
    } else if (character === "(") {
      depth += 1;
    } else if (character === ")") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
};
