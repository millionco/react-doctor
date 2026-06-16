// Pattern scans repeatedly match capability keywords that live only inside
// string literals — a tool's human-readable `description`, prose like
// "ALWAYS fetch the underlying numbers first". This blanks string-literal
// contents with spaces so a keyword gate can require a real code occurrence;
// the delimiters, newlines, and every offset are preserved so match indices,
// lines, and columns still map 1:1 onto the original file. Expects
// comment-stripped input so a quote inside a comment is never treated as a
// string delimiter.
export const stripStringLiteralsPreservingPositions = (content: string): string => {
  const characters = content.split("");
  let stringDelimiter: string | null = null;
  let index = 0;

  while (index < content.length) {
    const character = content[index];

    if (stringDelimiter !== null) {
      if (character === "\\") {
        characters[index] = " ";
        if (content[index + 1] !== undefined && content[index + 1] !== "\n") {
          characters[index + 1] = " ";
        }
        index += 2;
        continue;
      }
      if (character === stringDelimiter) {
        stringDelimiter = null;
        index += 1;
        continue;
      }
      if (character !== "\n") characters[index] = " ";
      index += 1;
      continue;
    }

    if (character === '"' || character === "'" || character === "`") {
      stringDelimiter = character;
      index += 1;
      continue;
    }

    index += 1;
  }

  return characters.join("");
};
