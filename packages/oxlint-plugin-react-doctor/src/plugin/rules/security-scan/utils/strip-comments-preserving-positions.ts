const WHITESPACE_PATTERN = /\s/;
// Unicode-aware: a division after an identifier ending in a non-ASCII letter
// (`café / total`, `合計 / 個数`) must still read as division. An ASCII-only
// class classified those as regex starts and blanked the code up to the next
// slash — the exact opposite of the "misclassify toward division is safe"
// invariant this file relies on.
const IDENTIFIER_CHARACTER_PATTERN = /[\p{ID_Continue}$]/u;

const NEWLINE_CHAR_CODE = 0x0a;
const DOUBLE_QUOTE_CHAR_CODE = 0x22;
const DOLLAR_CHAR_CODE = 0x24;
const SINGLE_QUOTE_CHAR_CODE = 0x27;
const ASTERISK_CHAR_CODE = 0x2a;
const SLASH_CHAR_CODE = 0x2f;
const BACKSLASH_CHAR_CODE = 0x5c;
const BACKTICK_CHAR_CODE = 0x60;
const OPEN_BRACE_CHAR_CODE = 0x7b;
const CLOSE_BRACE_CHAR_CODE = 0x7d;

const CODE_MODE_TOKEN_PATTERN = /["'`/]/g;
const CODE_MODE_TOKEN_OR_BRACE_PATTERN = /["'`/{}]/g;
const DOUBLE_QUOTED_STRING_TOKEN_PATTERN = /["\\\n]/g;
const SINGLE_QUOTED_STRING_TOKEN_PATTERN = /['\\\n]/g;
const TEMPLATE_STRING_TOKEN_PATTERN = /[`\\$\n]/g;

// These keywords put a following `/` in expression position (`return /x/`)
// even though they end with an identifier character.
const REGEX_PRECEDING_KEYWORDS = new Set([
  "return",
  "typeof",
  "case",
  "in",
  "of",
  "new",
  "delete",
  "void",
  "instanceof",
  "do",
  "else",
  "yield",
  "await",
  "throw",
]);

interface BlankedRanges {
  readonly blank: (offset: number) => void;
  readonly blankSpan: (start: number, end: number) => void;
  readonly isBlanked: (offset: number) => boolean;
  readonly apply: (content: string) => string;
}

// Blanked positions as sorted `[start, end)` ranges instead of a per-character
// array: blanking only ever moves forward, and spans never contain a newline.
const createBlankedRanges = (): BlankedRanges => {
  const starts: number[] = [];
  const ends: number[] = [];
  let openStart = -1;
  let openEnd = -1;

  const closeOpenRange = (): void => {
    if (openStart < 0) return;
    starts.push(openStart);
    ends.push(openEnd);
    openStart = -1;
    openEnd = -1;
  };

  const blankSpan = (start: number, end: number): void => {
    if (start === openEnd) {
      openEnd = end;
      return;
    }
    if (start < openEnd) {
      openEnd = Math.max(openEnd, end);
      return;
    }
    closeOpenRange();
    openStart = start;
    openEnd = end;
  };

  return {
    blank: (offset) => blankSpan(offset, offset + 1),
    blankSpan,
    isBlanked: (offset) => {
      if (offset >= openStart && offset < openEnd) return true;
      for (let rangeIndex = starts.length - 1; rangeIndex >= 0; rangeIndex -= 1) {
        if (starts[rangeIndex] > offset) continue;
        return ends[rangeIndex] > offset;
      }
      return false;
    },
    apply: (content) => {
      closeOpenRange();
      if (starts.length === 0) return content;
      const pieces: string[] = [];
      let copiedUpTo = 0;
      for (let rangeIndex = 0; rangeIndex < starts.length; rangeIndex += 1) {
        pieces.push(
          content.slice(copiedUpTo, starts[rangeIndex]),
          " ".repeat(ends[rangeIndex] - starts[rangeIndex]),
        );
        copiedUpTo = ends[rangeIndex];
      }
      pieces.push(content.slice(copiedUpTo));
      return pieces.join("");
    },
  };
};

// Whether a `/` at `slashIndex` sits in expression position (a regex literal)
// rather than operator position (division). Looks at the last significant
// character before it in the already-blanked output, so blanked comments don't
// count as preceding tokens. A value-ending token — identifier, number, `)`,
// `]`, a closing quote, a JSX `}`/`>`, a postfix `++`/`--`, or a TS non-null
// `!` — means division; anything else (or nothing) means a regex can start
// here. Misclassifying toward "division" is the safe direction: the slash is
// then lexed as plain code, which is exactly the pre-regex-support behavior.
const isRegexLiteralStart = (
  content: string,
  blankedRanges: BlankedRanges,
  slashIndex: number,
): boolean => {
  const characterAt = (offset: number): string =>
    blankedRanges.isBlanked(offset) ? " " : content[offset];
  let cursor = slashIndex - 1;
  while (cursor >= 0 && WHITESPACE_PATTERN.test(characterAt(cursor))) cursor -= 1;
  if (cursor < 0) return true;
  const previousCharacter = characterAt(cursor);
  const characterBefore = cursor > 0 ? characterAt(cursor - 1) : "";
  if (IDENTIFIER_CHARACTER_PATTERN.test(previousCharacter)) {
    let wordStartIndex = cursor;
    while (
      wordStartIndex > 0 &&
      IDENTIFIER_CHARACTER_PATTERN.test(characterAt(wordStartIndex - 1))
    ) {
      wordStartIndex -= 1;
    }
    // `obj.return / 2` is a property access, not the keyword.
    if (wordStartIndex > 0 && characterAt(wordStartIndex - 1) === ".") return false;
    return REGEX_PRECEDING_KEYWORDS.has(content.slice(wordStartIndex, cursor + 1));
  }
  // `</` opens a JSX closing tag, never a regex.
  if (previousCharacter === "<") return false;
  // `=> /regex/` (arrow body) is expression position; any other `>` ends a
  // value-ish token (a sibling JSX `/>`, a generic close, a comparison).
  if (previousCharacter === ">") return characterBefore === "=";
  // Postfix `++` / `--` ends a value (`count++ / total`); a single binary
  // `+` / `-` keeps expression position.
  if (previousCharacter === "+" || previousCharacter === "-") {
    return characterBefore !== previousCharacter;
  }
  // A TS non-null assertion (`value!`) ends a value; a prefix `!` doesn't.
  if (previousCharacter === "!") {
    return !(
      IDENTIFIER_CHARACTER_PATTERN.test(characterBefore) ||
      characterBefore === ")" ||
      characterBefore === "]"
    );
  }
  return !(
    previousCharacter === ")" ||
    previousCharacter === "]" ||
    previousCharacter === "}" ||
    previousCharacter === '"' ||
    previousCharacter === "'" ||
    previousCharacter === "`"
  );
};

// Index just past a regex literal's closing `/`, honoring escapes and `[...]`
// character classes (where `/` is not a terminator). Returns null when no
// closing slash exists on the line — regex literals cannot span a raw newline,
// so the opening slash was division after all. A candidate terminator whose
// next character is also `/` is rejected too: the scan collided with the first
// slash of a real `//` comment, so treating the span as a regex would un-strip
// the comment (the comment tail would be blanked either way, so nothing real is
// lost). The `/*` case is deliberately NOT rejected here — a real `/regex/`
// can be immediately followed by a `*` operator (`/ab/* 2`), and blanking that
// as a comment would erase live code; a mislexed `/*` collision only survives
// for the rare non-identifier false-regex starts (`x!! / y`), the same residue
// the `//` guard already tolerates.
const findRegexLiteralEnd = (content: string, slashIndex: number): number | null => {
  let cursor = slashIndex + 1;
  let isInsideCharacterClass = false;
  while (cursor < content.length) {
    const character = content[cursor];
    if (character === "\\") {
      cursor += 2;
      continue;
    }
    if (character === "\n") return null;
    if (character === "[") {
      isInsideCharacterClass = true;
    } else if (character === "]") {
      isInsideCharacterClass = false;
    } else if (character === "/" && !isInsideCharacterClass) {
      if (content[cursor + 1] === "/") return null;
      return cursor + 1;
    }
    cursor += 1;
  }
  return null;
};

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
  delimiterCharCode: number,
): boolean => {
  for (let cursor = openQuoteIndex + 1; cursor < content.length; cursor += 1) {
    const charCode = content.charCodeAt(cursor);
    if (charCode === BACKSLASH_CHAR_CODE) {
      cursor += 1;
      continue;
    }
    if (charCode === delimiterCharCode) return false;
    if (WHITESPACE_PATTERN.test(content[cursor])) return true;
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
  const contentLength = content.length;
  const blankedRanges = createBlankedRanges();
  // Char code of the open string's delimiter; -1 outside strings.
  let stringDelimiterCharCode = -1;
  let isBlankingString = false;
  // Brace depth of each open template `${…}` expression, innermost last.
  const templateExpressionDepths: number[] = [];
  let index = 0;

  const blankUnlessNewline = (offset: number): void => {
    if (offset >= contentLength || content.charCodeAt(offset) === NEWLINE_CHAR_CODE) return;
    blankedRanges.blank(offset);
  };

  while (index < contentLength) {
    if (stringDelimiterCharCode === -1) {
      const codeModeTokenPattern =
        templateExpressionDepths.length > 0
          ? CODE_MODE_TOKEN_OR_BRACE_PATTERN
          : CODE_MODE_TOKEN_PATTERN;
      codeModeTokenPattern.lastIndex = index;
      const codeModeToken = codeModeTokenPattern.exec(content);
      if (codeModeToken === null) break;
      index = codeModeToken.index;
    } else {
      const stringModeTokenPattern =
        stringDelimiterCharCode === DOUBLE_QUOTE_CHAR_CODE
          ? DOUBLE_QUOTED_STRING_TOKEN_PATTERN
          : stringDelimiterCharCode === SINGLE_QUOTE_CHAR_CODE
            ? SINGLE_QUOTED_STRING_TOKEN_PATTERN
            : TEMPLATE_STRING_TOKEN_PATTERN;
      stringModeTokenPattern.lastIndex = index;
      const stringModeToken = stringModeTokenPattern.exec(content);
      const stringTextEnd = stringModeToken === null ? contentLength : stringModeToken.index;
      if (isBlankingString && stringTextEnd > index) blankedRanges.blankSpan(index, stringTextEnd);
      index = stringTextEnd;
      if (stringModeToken === null) break;
    }
    const charCode = content.charCodeAt(index);
    const nextCharCode = content.charCodeAt(index + 1);

    if (stringDelimiterCharCode !== -1) {
      if (charCode === BACKSLASH_CHAR_CODE) {
        if (isBlankingString) {
          blankUnlessNewline(index);
          blankUnlessNewline(index + 1);
        }
        index += 2;
        continue;
      }
      // A raw newline cannot appear inside a '…' / "…" string, so an
      // unbalanced quote (most commonly a JSX apostrophe: `Don't`) must not
      // swallow the rest of the file — close string mode at the line end so
      // any lexer desync is bounded to a single line. Template literals
      // legitimately span lines and keep the multi-line behavior.
      if (charCode === NEWLINE_CHAR_CODE && stringDelimiterCharCode !== BACKTICK_CHAR_CODE) {
        stringDelimiterCharCode = -1;
        index += 1;
        continue;
      }
      if (charCode === stringDelimiterCharCode) {
        stringDelimiterCharCode = -1;
        index += 1;
        continue;
      }
      // A template `${…}` interpolation is code, not string text: leave it for
      // code mode so a real `fetch(url)`/`exec(cmd)` inside one is not erased.
      // Gated on blanking so the comment-only path keeps treating templates as
      // opaque strings (its consumers never look inside them).
      if (
        blankStringContents &&
        stringDelimiterCharCode === BACKTICK_CHAR_CODE &&
        charCode === DOLLAR_CHAR_CODE &&
        nextCharCode === OPEN_BRACE_CHAR_CODE
      ) {
        templateExpressionDepths.push(0);
        stringDelimiterCharCode = -1;
        index += 2;
        continue;
      }
      if (isBlankingString) blankUnlessNewline(index);
      index += 1;
      continue;
    }

    if (charCode === DOUBLE_QUOTE_CHAR_CODE || charCode === SINGLE_QUOTE_CHAR_CODE) {
      stringDelimiterCharCode = charCode;
      isBlankingString =
        blankStringContents && quotedLiteralHasWhitespace(content, index, charCode);
      index += 1;
      continue;
    }

    if (charCode === BACKTICK_CHAR_CODE) {
      stringDelimiterCharCode = BACKTICK_CHAR_CODE;
      isBlankingString = blankStringContents;
      index += 1;
      continue;
    }

    if (charCode === SLASH_CHAR_CODE && nextCharCode === SLASH_CHAR_CODE) {
      while (index < contentLength && content.charCodeAt(index) !== NEWLINE_CHAR_CODE) {
        blankedRanges.blank(index);
        index += 1;
      }
      continue;
    }

    if (charCode === SLASH_CHAR_CODE && nextCharCode === ASTERISK_CHAR_CODE) {
      while (index < contentLength) {
        if (
          content.charCodeAt(index) === ASTERISK_CHAR_CODE &&
          content.charCodeAt(index + 1) === SLASH_CHAR_CODE
        ) {
          blankedRanges.blank(index);
          blankedRanges.blank(index + 1);
          index += 2;
          break;
        }
        blankUnlessNewline(index);
        index += 1;
      }
      continue;
    }

    // A regex literal's body routinely contains the very tokens this scanner
    // keys on (`/https:\/\//` ends in what looks like a `//` comment; `/"/`
    // opens what looks like a string). Skip over it as one opaque token so the
    // rest of the line is still lexed as code; in string-blanking mode its
    // interior is blanked like prose so pattern words inside it don't count as
    // call sites.
    if (charCode === SLASH_CHAR_CODE) {
      const regexEndIndex = isRegexLiteralStart(content, blankedRanges, index)
        ? findRegexLiteralEnd(content, index)
        : null;
      if (regexEndIndex !== null) {
        if (blankStringContents) {
          for (
            let interiorIndex = index + 1;
            interiorIndex < regexEndIndex - 1;
            interiorIndex += 1
          ) {
            blankUnlessNewline(interiorIndex);
          }
        }
        index = regexEndIndex;
        continue;
      }
    }

    // Track brace depth inside a template expression so the matching `}` returns
    // to the enclosing template string and resumes blanking its static text.
    if (templateExpressionDepths.length > 0) {
      const innermost = templateExpressionDepths.length - 1;
      if (charCode === OPEN_BRACE_CHAR_CODE) {
        templateExpressionDepths[innermost] += 1;
      } else if (charCode === CLOSE_BRACE_CHAR_CODE) {
        if (templateExpressionDepths[innermost] === 0) {
          templateExpressionDepths.pop();
          stringDelimiterCharCode = BACKTICK_CHAR_CODE;
          isBlankingString = blankStringContents;
        } else {
          templateExpressionDepths[innermost] -= 1;
        }
      }
    }

    index += 1;
  }

  return blankedRanges.apply(content);
};

export const stripCommentsPreservingPositions = (content: string): string =>
  content.includes("//") || content.includes("/*")
    ? blankNonCodePreservingPositions(content, false)
    : content;

export const stripCommentsAndStringLiteralsPreservingPositions = (content: string): string =>
  blankNonCodePreservingPositions(content, true);
