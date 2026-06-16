// A module specifier carries a real capability signal in the string itself
// (`import { execFile } from "node:child_process"`, `require("axios")`), so
// those strings are preserved even when string contents are otherwise blanked.
const MODULE_SPECIFIER_KEYWORDS = new Set(["from", "import", "require"]);
const ASCII_LETTER_PATTERN = /[A-Za-z]/;
const IDENTIFIER_TAIL_PATTERN = /[\w$]/;
const WHITESPACE_PATTERN = /\s/;

// True when the string opening at `quoteIndex` is an `import`/`from`/`require`
// module specifier rather than ordinary data, walking back over whitespace and
// the optional call paren of `import(...)` / `require(...)`.
const isModuleSpecifierQuote = (content: string, quoteIndex: number): boolean => {
  let cursor = quoteIndex - 1;
  while (cursor >= 0 && WHITESPACE_PATTERN.test(content[cursor])) cursor -= 1;
  if (content[cursor] === "(") {
    cursor -= 1;
    while (cursor >= 0 && WHITESPACE_PATTERN.test(content[cursor])) cursor -= 1;
  }
  const keywordEnd = cursor;
  while (cursor >= 0 && ASCII_LETTER_PATTERN.test(content[cursor])) cursor -= 1;
  const charBeforeKeyword = content[cursor];
  // Reject letters glued to a longer identifier (`_from`, `$require`).
  if (charBeforeKeyword !== undefined && IDENTIFIER_TAIL_PATTERN.test(charBeforeKeyword)) {
    return false;
  }
  return MODULE_SPECIFIER_KEYWORDS.has(content.slice(cursor + 1, keywordEnd + 1));
};

// Pattern scans repeatedly match keyword pairs inside comments ("Ajv compiles
// schemas via `new Function(...)`", JSX comments mentioning redirects). This
// blanks comment text with spaces so every match index, line, and column in
// the stripped content still maps 1:1 onto the original file. When
// `blankStringContents` is set it also blanks string-literal interiors (the
// delimiting quotes are kept), so a capability keyword that appears only in
// prose — a tool `description: "...ALWAYS fetch the numbers..."` — no longer
// counts as a real call site; module specifiers are exempt. Newlines are
// always preserved for line mapping.
const blankNonCodePreservingPositions = (content: string, blankStringContents: boolean): string => {
  const characters = content.split("");
  let stringDelimiter: string | null = null;
  let isBlankingString = false;
  let index = 0;

  const blankUnlessNewline = (offset: number): void => {
    if (content[offset] !== "\n") characters[offset] = " ";
  };

  while (index < content.length) {
    const character = content[index];
    const nextCharacter = content[index + 1];

    if (stringDelimiter !== null) {
      if (character === "\\") {
        if (isBlankingString) {
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
      if (isBlankingString) blankUnlessNewline(index);
      index += 1;
      continue;
    }

    if (character === '"' || character === "'" || character === "`") {
      stringDelimiter = character;
      isBlankingString = blankStringContents && !isModuleSpecifierQuote(content, index);
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
