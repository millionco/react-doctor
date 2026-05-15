import { JSX_OPENER_SCAN_MAX_LINES } from "../constants.js";

const JSX_OPENER_TAG_PATTERN = /<[A-Za-z][\w.]*/g;
const JSX_TAG_NAME_FOLLOW = /[A-Za-z]/;

const isOpenerMatchInsideLineComment = (line: string, openerCharIndex: number): boolean => {
  let stringDelimiter: '"' | "'" | "`" | null = null;
  for (let charIndex = 0; charIndex < openerCharIndex; charIndex++) {
    const character = line[charIndex];
    if (stringDelimiter !== null) {
      if (character === "\\") {
        charIndex++;
        continue;
      }
      if (character === stringDelimiter) stringDelimiter = null;
      continue;
    }
    if (character === '"' || character === "'" || character === "`") {
      stringDelimiter = character;
      continue;
    }
    if (character === "/" && line[charIndex + 1] === "/") return true;
  }
  return false;
};

const findOpenerTagOnLine = (line: string): { startCharIndex: number } | null => {
  for (const match of line.matchAll(JSX_OPENER_TAG_PATTERN)) {
    if (match.index === undefined) continue;
    if (!isOpenerMatchInsideLineComment(line, match.index)) {
      return { startCharIndex: match.index + match[0].length };
    }
  }
  return null;
};

export const findJsxOpenerSpan = (lines: string[], openerLineIndex: number): number | null => {
  const openerLine = lines[openerLineIndex];
  if (openerLine === undefined) return null;
  const opener = findOpenerTagOnLine(openerLine);
  if (!opener) return null;

  const lookaheadLimit = Math.min(lines.length, openerLineIndex + JSX_OPENER_SCAN_MAX_LINES);
  let braceDepth = 0;
  let innerAngleDepth = 0;
  let stringDelimiter: '"' | "'" | "`" | null = null;

  for (let lineIndex = openerLineIndex; lineIndex < lookaheadLimit; lineIndex++) {
    const currentLine = lines[lineIndex];
    const startCharForLine = lineIndex === openerLineIndex ? opener.startCharIndex : 0;

    for (let charIndex = startCharForLine; charIndex < currentLine.length; charIndex++) {
      const character = currentLine[charIndex];

      if (stringDelimiter !== null) {
        if (character === "\\") {
          charIndex++;
          continue;
        }
        if (character === stringDelimiter) stringDelimiter = null;
        continue;
      }

      if (character === '"' || character === "'" || character === "`") {
        stringDelimiter = character;
        continue;
      }

      if (character === "{") {
        braceDepth++;
        continue;
      }
      if (character === "}") {
        braceDepth--;
        continue;
      }

      if (braceDepth !== 0) continue;

      if (character === "<") {
        const followCharacter = currentLine[charIndex + 1];
        if (followCharacter !== undefined && JSX_TAG_NAME_FOLLOW.test(followCharacter)) {
          innerAngleDepth++;
        }
        continue;
      }

      if (character !== ">") continue;

      const previousCharacter = currentLine[charIndex - 1];
      const nextCharacter = currentLine[charIndex + 1];
      if (previousCharacter === "=" || nextCharacter === "=") continue;
      if (innerAngleDepth > 0) {
        innerAngleDepth--;
        continue;
      }
      return lineIndex;
    }
  }

  return null;
};
