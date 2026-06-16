// Pattern scans repeatedly match keyword pairs inside comments ("Ajv compiles
// schemas via `new Function(...)`", JSX comments mentioning redirects). This
// blanks comment text with spaces so every match index, line, and column in
// the stripped content still maps 1:1 onto the original file. When
// `blankStringContents` is set it also blanks string-literal interiors (the
// delimiting quotes are kept), so a capability keyword that appears only in
// prose — a tool `description: "...ALWAYS fetch the numbers..."` — no longer
// counts as a real call site. Newlines are always preserved for line mapping.
const blankNonCodePreservingPositions = (content: string, blankStringContents: boolean): string => {
  const characters = content.split("");
  let stringDelimiter: string | null = null;
  let index = 0;

  const blankUnlessNewline = (offset: number): void => {
    if (content[offset] !== "\n") characters[offset] = " ";
  };

  while (index < content.length) {
    const character = content[index];
    const nextCharacter = content[index + 1];

    if (stringDelimiter !== null) {
      if (character === "\\") {
        if (blankStringContents) {
          blankUnlessNewline(index);
          blankUnlessNewline(index + 1);
        }
        index += 2;
        continue;
      }
      if (character === stringDelimiter) {
        stringDelimiter = null;
        index += 1;
        continue;
      }
      if (blankStringContents) blankUnlessNewline(index);
      index += 1;
      continue;
    }

    if (character === '"' || character === "'" || character === "`") {
      stringDelimiter = character;
      index += 1;
      continue;
    }

    if (character === "/" && nextCharacter === "/") {
      while (index < content.length && content[index] !== "\n") {
        characters[index] = " ";
        index += 1;
      }
      continue;
    }

    if (character === "/" && nextCharacter === "*") {
      while (index < content.length) {
        if (content[index] === "*" && content[index + 1] === "/") {
          characters[index] = " ";
          characters[index + 1] = " ";
          index += 2;
          break;
        }
        blankUnlessNewline(index);
        index += 1;
      }
      continue;
    }

    index += 1;
  }

  return characters.join("");
};

export const stripCommentsPreservingPositions = (content: string): string =>
  blankNonCodePreservingPositions(content, false);

export const stripCommentsAndStringLiteralsPreservingPositions = (content: string): string =>
  blankNonCodePreservingPositions(content, true);
