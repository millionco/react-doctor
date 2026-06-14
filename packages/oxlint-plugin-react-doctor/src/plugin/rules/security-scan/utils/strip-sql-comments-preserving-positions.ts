// Blanks SQL `--` line comments and `/* */` block comments with spaces so a
// commented-out statement (e.g. `-- create table legacy (id int);`) is not
// scanned as live DDL. Single- and double-quoted literals (with doubled-quote
// escaping, the SQL convention) are respected so a `--` or quote inside a
// string is not mistaken for a comment. Offsets, lines, and columns are
// preserved 1:1 so reported match locations stay correct.
export const stripSqlCommentsPreservingPositions = (content: string): string => {
  const characters = content.split("");
  let index = 0;
  let stringDelimiter: string | null = null;

  while (index < content.length) {
    const character = content[index];

    if (stringDelimiter !== null) {
      if (character === stringDelimiter) {
        if (content[index + 1] === stringDelimiter) {
          index += 2;
          continue;
        }
        stringDelimiter = null;
      }
      index += 1;
      continue;
    }

    if (character === "'" || character === '"') {
      stringDelimiter = character;
      index += 1;
      continue;
    }

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

    index += 1;
  }

  return characters.join("");
};
