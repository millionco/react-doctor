// Blanks the parts of a SQL migration that must not be matched as live DDL —
// `--` line comments, `/* */` block comments, single-quoted string literals,
// and `$tag$…$tag$` dollar-quoted strings (e.g. function bodies / dynamic SQL)
// — by overwriting them with spaces. Double-quoted identifiers are preserved
// because a quoted table name (`"myTable"`) is real DDL. Offsets, lines, and
// columns are preserved 1:1 so reported match locations stay correct.
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
        for (let blankIndex = index; blankIndex < endIndex; blankIndex += 1) {
          if (content[blankIndex] !== "\n") characters[blankIndex] = " ";
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
