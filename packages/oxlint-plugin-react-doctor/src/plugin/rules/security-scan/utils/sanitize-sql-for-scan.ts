// Blanks the parts of a SQL migration that must not be matched as live DDL —
// `--` line comments, `/* */` block comments, single-quoted string literals
// (seed/doc text, and dynamic SQL outside `EXECUTE`), and `$tag$…$tag$`
// dollar-quoted STRING VALUES and FUNCTION BODIES — by overwriting them with
// spaces. Double-quoted identifiers are preserved (a quoted table name like
// `"myTable"` is real DDL), and an immediately-executed `DO $$ … $$` block is
// kept visible (its comments and non-`EXECUTE` strings still blanked) so a real
// `alter table … enable row level security` inside it counts. A `CREATE
// FUNCTION … AS $$ … $$` body is NOT kept visible: its DDL runs only when the
// function is called, not at migration time, so it must not vouch for RLS.
// Offsets, lines, and columns are preserved 1:1 so locations stay correct.
const DOLLAR_QUOTE_TAG_PATTERN = /^\$[A-Za-z_]?\w*\$/;

// Keywords that introduce an immediately-executed dollar-quoted body: `DO $$`
// and the `DO LANGUAGE <lang> $$` form (where the body follows the language
// name). `AS` is excluded on purpose — it precedes a function body, which runs
// on invocation, not at migration time. A bare language name can only precede
// `$$` in the `DO LANGUAGE` position, so matching it is safe.
const CODE_BODY_KEYWORDS = new Set([
  "do",
  "plpgsql",
  "sql",
  "plpython3u",
  "plpythonu",
  "plperl",
  "plperlu",
  "plv8",
]);

// Lowercased identifier immediately preceding `beforeIndex` (skipping
// whitespace) — used to classify a `$$` opener by its keyword (`do` or a bare
// language name = an immediately-executed code body; `as`/anything else = a
// blanked function body or string value).
const precedingKeyword = (content: string, beforeIndex: number): string => {
  let lookBack = beforeIndex - 1;
  while (lookBack >= 0 && /\s/.test(content[lookBack] ?? "")) lookBack -= 1;
  let wordStart = lookBack;
  // Identifier characters include digits/underscore so multi-part language
  // names like `plpython3u` are read whole, not truncated to `u`.
  while (wordStart >= 0 && /[A-Za-z0-9_]/.test(content[wordStart] ?? "")) wordStart -= 1;
  return content.slice(wordStart + 1, lookBack + 1).toLowerCase();
};

// Sanitizes the interior of a kept-visible `DO`/`AS` code body in place: blanks
// comments and single-quoted strings (so `RAISE NOTICE '… create table …'` and
// seed text can't false-match) while keeping double-quoted identifiers, direct
// DDL, and `EXECUTE` dynamic SQL visible. EXECUTE is tracked at the statement
// level (until the next `;`), so `EXECUTE format('alter table …', …)` and
// concatenated dynamic SQL keep their strings visible too. `PERFORM` is NOT
// dynamic SQL — it runs a query/expression written directly, never a string —
// so a literal in a `PERFORM` argument is never executed and stays blanked.
const blankCodeBodyInterior = (
  content: string,
  characters: string[],
  start: number,
  end: number,
): void => {
  let index = start;
  let inExecuteStatement = false;
  while (index < end) {
    const character = content[index];

    if (character === ";") {
      inExecuteStatement = false;
      index += 1;
      continue;
    }

    if (/[A-Za-z_]/.test(character)) {
      let wordEnd = index;
      while (wordEnd < end && /[A-Za-z0-9_]/.test(content[wordEnd] ?? "")) wordEnd += 1;
      const word = content.slice(index, wordEnd).toLowerCase();
      if (word === "execute") inExecuteStatement = true;
      index = wordEnd;
      continue;
    }

    if (character === "'") {
      const keepVisible = inExecuteStatement;
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
