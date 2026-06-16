const WHITESPACE_PATTERN = /\s/;

// A capability keyword is a real signal as a single-token literal — a module
// specifier (`"node:child_process"`, `"axios"`) or identifier-shaped value —
// and noise as prose (a tool `description: "...ALWAYS fetch the numbers..."`).
// Specifiers and identifiers never contain whitespace; prose is multiple words.
// Keying on the literal's own content (rather than the call syntax around it)
// preserves every import/require form — `from "x"`, `require("x")`,
// `(0, require)("x")`, `require?.("x")` — without trying to parse the callee.
const quotedLiteralHasWhitespace = (
  content: string,
  openQuoteIndex: number,
  delimiter: string,
): boolean => {
  for (let cursor = openQuoteIndex + 1; cursor < content.length; cursor += 1) {
    const character = content[cursor];
    if (character === "\\") {
      cursor += 1;
      continue;
    }
    if (character === delimiter) return false;
    if (WHITESPACE_PATTERN.test(character)) return true;
  }
  return false;
};

// Pattern scans repeatedly match keyword pairs inside comments ("Ajv compiles
// schemas via `new Function(...)`", JSX comments mentioning redirects). This
// blanks comment text with spaces so every match index, line, and column in
// the stripped content still maps 1:1 onto the original file. When
// `blankStringContents` is set it also blanks string-literal interiors (the
// delimiting quotes are kept), so a capability keyword that appears only in
// prose — a tool `description: "...ALWAYS fetch the numbers..."` — no longer
// counts as a real call site; single-token literals (module specifiers,
// identifiers) are exempt. Newlines are always preserved for line mapping.
const blankNonCodePreservingPositions = (content: string, blankStringContents: boolean): string => {
  const characters = content.split("");
  let stringDelimiter: string | null = null;
  let isBlankingString = false;
  // Brace depth of each open template `${…}` expression, innermost last.
  const templateExpressionDepths: number[] = [];
  let index = 0;

  const blankUnlessNewline = (offset: number): void => {
    if (offset < content.length && content[offset] !== "\n") characters[offset] = " ";
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
      // A template `${…}` interpolation is code, not string text: leave it for
      // code mode so a real `fetch(url)`/`exec(cmd)` inside one is not erased.
      // Gated on blanking so the comment-only path keeps treating templates as
      // opaque strings (its consumers never look inside them).
      if (
        blankStringContents &&
        stringDelimiter === "`" &&
        character === "$" &&
        nextCharacter === "{"
      ) {
        templateExpressionDepths.push(0);
        stringDelimiter = null;
        index += 2;
        continue;
      }
      if (isBlankingString) blankUnlessNewline(index);
      index += 1;
      continue;
    }

    if (character === '"' || character === "'") {
      stringDelimiter = character;
      isBlankingString =
        blankStringContents && quotedLiteralHasWhitespace(content, index, character);
      index += 1;
      continue;
    }

    if (character === "`") {
      stringDelimiter = "`";
      isBlankingString = blankStringContents;
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

    // Track brace depth inside a template expression so the matching `}` returns
    // to the enclosing template string and resumes blanking its static text.
    if (templateExpressionDepths.length > 0) {
      const innermost = templateExpressionDepths.length - 1;
      if (character === "{") {
        templateExpressionDepths[innermost] += 1;
      } else if (character === "}") {
        if (templateExpressionDepths[innermost] === 0) {
          templateExpressionDepths.pop();
          stringDelimiter = "`";
          isBlankingString = blankStringContents;
        } else {
          templateExpressionDepths[innermost] -= 1;
        }
      }
    }

    index += 1;
  }

  return characters.join("");
};

export const stripCommentsPreservingPositions = (content: string): string =>
  blankNonCodePreservingPositions(content, false);

export const stripCommentsAndStringLiteralsPreservingPositions = (content: string): string =>
  blankNonCodePreservingPositions(content, true);
