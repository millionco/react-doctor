// Builds the "is this keyword in real code?" view used by capability/keyword
// gates: string-literal *contents* are blanked with spaces so a keyword that
// appears only in prose — a tool's human-readable `description`, "ALWAYS fetch
// the numbers first" — can't satisfy a gate. Three things stay, because they are
// code rather than prose: module-specifier strings (`from "node:child_process"`,
// `require("node:fs")`), template-literal `${…}` interpolations (e.g. a real
// `${exec(cmd)}` call), and every delimiter/newline/offset (so a blanked region
// still maps 1:1 onto the original file). Expects comment-stripped input so a
// quote inside a comment is never treated as a string delimiter.
const MODULE_SPECIFIER_KEYWORDS = new Set(["from", "import", "require"]);

interface StringFrame {
  readonly kind: "string";
  readonly delimiter: string;
  readonly shouldBlank: boolean;
}

interface TemplateFrame {
  readonly kind: "template";
}

interface InterpolationFrame {
  readonly kind: "interpolation";
  braceDepth: number;
}

type ScanFrame = StringFrame | TemplateFrame | InterpolationFrame;

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
  const frames: ScanFrame[] = [];
  let index = 0;

  const blankCharacter = (characterIndex: number): void => {
    if (content[characterIndex] !== "\n") characters[characterIndex] = " ";
  };

  while (index < content.length) {
    const character = content[index];
    const currentFrame = frames.at(-1);

    if (currentFrame?.kind === "string") {
      if (character === "\\") {
        if (currentFrame.shouldBlank) {
          blankCharacter(index);
          if (content[index + 1] !== undefined) blankCharacter(index + 1);
        }
        index += 2;
        continue;
      }
      if (character === currentFrame.delimiter) {
        frames.pop();
        index += 1;
        continue;
      }
      if (currentFrame.shouldBlank) blankCharacter(index);
      index += 1;
      continue;
    }

    if (currentFrame?.kind === "template") {
      if (character === "\\") {
        blankCharacter(index);
        if (content[index + 1] !== undefined) blankCharacter(index + 1);
        index += 2;
        continue;
      }
      if (character === "`") {
        frames.pop();
        index += 1;
        continue;
      }
      // `${…}` is executable code, not prose, so descend into it instead of
      // blanking — a capability call written only there must still count.
      if (character === "$" && content[index + 1] === "{") {
        frames.push({ kind: "interpolation", braceDepth: 1 });
        index += 2;
        continue;
      }
      blankCharacter(index);
      index += 1;
      continue;
    }

    // Top-level code or an interpolation expression: keep everything, but
    // balance interpolation braces so the matching `}` returns to the template.
    if (currentFrame?.kind === "interpolation") {
      if (character === "{") {
        currentFrame.braceDepth += 1;
        index += 1;
        continue;
      }
      if (character === "}") {
        currentFrame.braceDepth -= 1;
        if (currentFrame.braceDepth === 0) frames.pop();
        index += 1;
        continue;
      }
    }

    if (character === '"' || character === "'") {
      frames.push({
        kind: "string",
        delimiter: character,
        shouldBlank: !isModuleSpecifierQuote(content, index),
      });
      index += 1;
      continue;
    }
    if (character === "`") {
      frames.push({ kind: "template" });
      index += 1;
      continue;
    }

    index += 1;
  }

  return characters.join("");
};
