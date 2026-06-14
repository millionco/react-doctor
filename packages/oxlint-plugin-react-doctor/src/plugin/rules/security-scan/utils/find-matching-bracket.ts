// Index of the bracket that closes the one at `openIndex` (`(`, `{`, or `[`),
// ignoring brackets inside string/template literals. Returns -1 if the
// brackets never balance (truncated/odd source).
export const findMatchingBracket = (content: string, openIndex: number): number => {
  const open = content[openIndex];
  const close = open === "(" ? ")" : open === "{" ? "}" : open === "[" ? "]" : "";
  if (close === "") return -1;
  let depth = 0;
  let stringDelimiter: string | null = null;
  for (let index = openIndex; index < content.length; index += 1) {
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
    } else if (character === open) {
      depth += 1;
    } else if (character === close) {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
};
