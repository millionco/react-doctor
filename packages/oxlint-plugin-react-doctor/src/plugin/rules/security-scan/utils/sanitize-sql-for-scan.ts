// Blanks the parts of a SQL migration that must not be matched as live DDL —
// `--` line comments, `/* */` block comments, and single-quoted string
// literals (which also covers dynamic SQL passed as `EXECUTE '…'`) — by
// overwriting them with spaces. Double-quoted identifiers are preserved (a
// quoted table name like `"myTable"` is real DDL), and `$tag$…$tag$`
// dollar-quoted blocks are left intact so a real `alter table … enable row
// level security` inside a `DO $$ … $$` block still counts. Offsets, lines,
// and columns are preserved 1:1 so reported match locations stay correct.
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
