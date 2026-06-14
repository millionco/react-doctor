// Blanks the parts of a SQL migration that must not be matched as live DDL —
// `--` line comments, `/* */` block comments, single-quoted string literals
// (seed/doc text, and dynamic SQL outside `EXECUTE`), and `$tag$…$tag$`
// dollar-quoted STRING VALUES — by overwriting them with spaces. Double-quoted
// identifiers are preserved (a quoted table name like `"myTable"` is real DDL),
// and a `DO $$ … $$` / `AS $$ … $$` code body is kept visible (its comments and
// non-`EXECUTE` strings still blanked) so a real `alter table … enable row
// level security` inside it counts. Offsets, lines, and columns are preserved
// 1:1 so reported match locations stay correct.
const DOLLAR_QUOTE_TAG_PATTERN = /^\$[A-Za-z_]?\w*\$/;

// Keywords that introduce an executable dollar-quoted body: `DO $$`, `AS $$`,
// and the `DO LANGUAGE <lang> $$` form (where the body follows the language
// name). A bare language name can only precede `$$` in that body position, so
// matching it does not risk a string-value false negative.
const CODE_BODY_KEYWORDS = new Set([
  "do",
  "as",
  "plpgsql",
  "sql",
  "plpython3u",
  "plpythonu",
  "plperl",
  "plperlu",
  "plv8",
]);

// Lowercased identifier immediately preceding `beforeIndex` (skipping
// whitespace) — used to classify a `$$`/`'` opener by its keyword (`do`/`as`
// code body, `execute`/`perform` dynamic SQL).
const precedingKeyword = (content: string, beforeIndex: number): string => {
  let lookBack = beforeIndex - 1;
  while (lookBack >= 0 && /\s/.test(content[lookBack] ?? "")) lookBack -= 1;
  let wordStart = lookBack;
  while (wordStart >= 0 && /[A-Za-z]/.test(content[wordStart] ?? "")) wordStart -= 1;
  return content.slice(wordStart + 1, lookBack + 1).toLowerCase();
};

// Sanitizes the interior of a kept-visible `DO`/`AS` code body in place: blanks
// comments and single-quoted strings (so `RAISE NOTICE '… create table …'` and
// seed text can't false-match) while keeping `EXECUTE`/`PERFORM` dynamic SQL,
// double-quoted identifiers, and direct DDL visible.
const blankCodeBodyInterior = (
  content: string,
  characters: string[],
  start: number,
  end: number,
): void => {
  let index = start;
  while (index < end) {
    const character = content[index];

    if (character === "'") {
      const keyword = precedingKeyword(content, index);
      const keepVisible = keyword === "execute" || keyword === "perform";
      if (!keepVisible) characters[index] = " ";
      index += 1;
      while (index < end) {
        if (content[index] === "'") {
          if (content[index + 1] === "'") {
            if (!keepVisible) {
              characters[index] = " ";
              characters[index + 1] = " ";
            }
            index += 2;
            continue;
          }
          if (!keepVisible) characters[index] = " ";
          index += 1;
          break;
        }
        if (!keepVisible && content[index] !== "\n") characters[index] = " ";
        index += 1;
      }
      continue;
    }

    if (character === '"') {
      index += 1;
      while (index < end) {
        if (content[index] === '"') {
          if (content[index + 1] === '"') {
            index += 2;
            continue;
          }
          index += 1;
          break;
        }
        index += 1;
      }
      continue;
    }

    if (character === "-" && content[index + 1] === "-") {
      while (index < end && content[index] !== "\n") {
        characters[index] = " ";
        index += 1;
      }
      continue;
    }

    if (character === "/" && content[index + 1] === "*") {
      while (index < end) {
        if (content[index] === "*" && content[index + 1] === "/") {
          characters[index] = " ";
          characters[index + 1] = " ";
          index += 2;
          break;
        }
        if (content[index] !== "\n") characters[index] = " ";
        index += 1;
      }
      continue;
    }

    index += 1;
  }
};

export const sanitizeSqlForScan = (content: string): string => {
  const characters = content.split("");
  let index = 0;

  while (index < content.length) {
    const character = content[index];

    if (character === "-" && content[index + 1] === "-") {
      while (index < content.length && content[index] !== "\n") {
        characters[index] = " ";
        index += 1;
      }
      continue;
    }

    if (character === "/" && content[index + 1] === "*") {
      while (index < content.length) {
        if (content[index] === "*" && content[index + 1] === "/") {
          characters[index] = " ";
          characters[index + 1] = " ";
          index += 2;
          break;
        }
        if (content[index] !== "\n") characters[index] = " ";
        index += 1;
      }
      continue;
    }

    if (character === "'") {
      characters[index] = " ";
      index += 1;
      while (index < content.length) {
        if (content[index] === "'") {
          // Doubled `''` is an escaped quote inside the literal, not the end.
          if (content[index + 1] === "'") {
            characters[index] = " ";
            characters[index + 1] = " ";
            index += 2;
            continue;
          }
          characters[index] = " ";
          index += 1;
          break;
        }
        if (content[index] !== "\n") characters[index] = " ";
        index += 1;
      }
      continue;
    }

    if (character === "$") {
      const tagMatch = DOLLAR_QUOTE_TAG_PATTERN.exec(content.slice(index));
      if (tagMatch !== null) {
        const tag = tagMatch[0];
        const closeIndex = content.indexOf(tag, index + tag.length);
        const endIndex = closeIndex < 0 ? content.length : closeIndex + tag.length;
        const keyword = precedingKeyword(content, index);
        if (CODE_BODY_KEYWORDS.has(keyword)) {
          blankCodeBodyInterior(content, characters, index + tag.length, endIndex);
        } else {
          for (let blankIndex = index; blankIndex < endIndex; blankIndex += 1) {
            if (content[blankIndex] !== "\n") characters[blankIndex] = " ";
          }
        }
        index = endIndex;
        continue;
      }
    }

    if (character === '"') {
      index += 1;
      while (index < content.length) {
        if (content[index] === '"') {
          if (content[index + 1] === '"') {
            index += 2;
            continue;
          }
          index += 1;
          break;
        }
        index += 1;
      }
      continue;
    }

    index += 1;
  }

  return characters.join("");
};
