// Blanks the parts of a SQL migration that must not be matched as live DDL —
// `--` line comments, `/* */` block comments, single-quoted string literals
// (which also covers dynamic SQL passed as `EXECUTE '…'`), and `$tag$…$tag$`
// dollar-quoted STRING VALUES (seed/doc text) — by overwriting them with
// spaces. Double-quoted identifiers are preserved (a quoted table name like
// `"myTable"` is real DDL), and a `DO $$ … $$` / `AS $$ … $$` code body is
// kept intact so a real `alter table … enable row level security` inside it
// still counts. Offsets, lines, and columns are preserved 1:1 so reported
// match locations stay correct.
const DOLLAR_QUOTE_TAG_PATTERN = /^\$[A-Za-z_]?\w*\$/;

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
        // `DO $$ … $$` / `AS $$ … $$` is executable SQL (keep visible); any
        // other dollar-quote is a string value (blank it).
        let lookBack = index - 1;
        while (lookBack >= 0 && /\s/.test(content[lookBack] ?? "")) lookBack -= 1;
        let wordStart = lookBack;
        while (wordStart >= 0 && /[A-Za-z]/.test(content[wordStart] ?? "")) wordStart -= 1;
        const precedingWord = content.slice(wordStart + 1, lookBack + 1).toLowerCase();
        const isCodeBody = precedingWord === "do" || precedingWord === "as";
        if (isCodeBody) {
          // Keep DDL and EXECUTE strings visible, but still blank comments
          // inside the body so a `-- create table … (` cannot false-match.
          let bodyIndex = index + tag.length;
          let bodyStringDelimiter: string | null = null;
          while (bodyIndex < endIndex) {
            const bodyChar = content[bodyIndex];
            if (bodyStringDelimiter !== null) {
              if (bodyChar === bodyStringDelimiter) {
                if (content[bodyIndex + 1] === bodyStringDelimiter) {
                  bodyIndex += 2;
                  continue;
                }
                bodyStringDelimiter = null;
              }
              bodyIndex += 1;
              continue;
            }
            if (bodyChar === "'" || bodyChar === '"') {
              bodyStringDelimiter = bodyChar;
              bodyIndex += 1;
              continue;
            }
            if (bodyChar === "-" && content[bodyIndex + 1] === "-") {
              while (bodyIndex < endIndex && content[bodyIndex] !== "\n") {
                characters[bodyIndex] = " ";
                bodyIndex += 1;
              }
              continue;
            }
            if (bodyChar === "/" && content[bodyIndex + 1] === "*") {
              while (bodyIndex < endIndex) {
                if (content[bodyIndex] === "*" && content[bodyIndex + 1] === "/") {
                  characters[bodyIndex] = " ";
                  characters[bodyIndex + 1] = " ";
                  bodyIndex += 2;
                  break;
                }
                if (content[bodyIndex] !== "\n") characters[bodyIndex] = " ";
                bodyIndex += 1;
              }
              continue;
            }
            bodyIndex += 1;
          }
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
