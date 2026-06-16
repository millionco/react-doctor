// Builds the "is this keyword in real code?" view used by capability/keyword
// gates: string-literal *contents* are blanked with spaces so a keyword that
// appears only in prose — a tool's human-readable `description`, "ALWAYS fetch
// the numbers first" — can't satisfy a gate. Module-specifier strings
// (`from "node:child_process"`, `require("node:fs")`) are kept, because an
// import path is code, not prose, and naming a dangerous module is a real
// capability signal. Delimiters, newlines, and every offset are preserved so a
// blanked region still maps 1:1 onto the original file. Expects comment-stripped
// input so a quote inside a comment is never treated as a string delimiter.
const MODULE_SPECIFIER_KEYWORDS = new Set(["from", "import", "require"]);

const isModuleSpecifierQuote = (content: string, quoteIndex: number): boolean => {
  let cursor = quoteIndex - 1;
  while (cursor >= 0 && /\s/.test(content[cursor])) cursor -= 1;
  if (content[cursor] === "(") {
    cursor -= 1;
    while (cursor >= 0 && /\s/.test(content[cursor])) cursor -= 1;
  }
  const wordEnd = cursor;
  while (cursor >= 0 && /[\w$]/.test(content[cursor])) cursor -= 1;
  const precedingWord = content.slice(cursor + 1, wordEnd + 1);
  if (!MODULE_SPECIFIER_KEYWORDS.has(precedingWord)) return false;
  // A member access (`Buffer.from("…")`, `db.import("…")`) is not an import.
  return content[cursor] !== ".";
};

export const stripStringLiteralsKeepingModuleSpecifiers = (content: string): string => {
  const characters = content.split("");
  let stringDelimiter: string | null = null;
  let isModuleSpecifier = false;
  let index = 0;

  while (index < content.length) {
    const character = content[index];

    if (stringDelimiter !== null) {
      if (character === "\\") {
        if (!isModuleSpecifier) {
          characters[index] = " ";
          if (content[index + 1] !== undefined && content[index + 1] !== "\n") {
            characters[index + 1] = " ";
          }
        }
        index += 2;
        continue;
      }
      if (character === stringDelimiter) {
        stringDelimiter = null;
        index += 1;
        continue;
      }
      if (!isModuleSpecifier && character !== "\n") characters[index] = " ";
      index += 1;
      continue;
    }

    if (character === '"' || character === "'" || character === "`") {
      stringDelimiter = character;
      isModuleSpecifier = isModuleSpecifierQuote(content, index);
      index += 1;
      continue;
    }

    index += 1;
  }

  return characters.join("");
};
