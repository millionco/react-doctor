import fs from "node:fs";
import { logger } from "./logger.js";

// HACK: per gitignore spec, a leading `\#` means a literal `#` in the
// pattern (used to match files literally named `#config`), and `\!`
// means a literal `!` (without the escape, leading `!` is the
// negation marker). We strip the backslash and pass the unescaped
// character through.
const stripGitignoreEscape = (pattern: string): string => {
  if (pattern.startsWith("\\#") || pattern.startsWith("\\!")) {
    return pattern.slice(1);
  }
  return pattern;
};

// Reads a gitignore-style file and returns each non-empty, non-comment
// line as a pattern. Used for `.eslintignore`, `.oxlintignore`,
// `.prettierignore`, and any other tool that follows the same syntax.
// Returns `[]` when the file is missing (the common case); on other
// read errors (EACCES, EBUSY, EIO) we warn so the user knows their
// patterns silently aren't being applied.
export const readIgnoreFile = (filePath: string): string[] => {
  let content: string;
  try {
    content = fs.readFileSync(filePath, "utf-8");
  } catch (error) {
    const errnoCode = (error as NodeJS.ErrnoException | null)?.code;
    if (errnoCode && errnoCode !== "ENOENT") {
      logger.warn(`Could not read ignore file ${filePath}: ${errnoCode}`);
    }
    return [];
  }
  const patterns: string[] = [];
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    if (trimmed.startsWith("#")) continue;
    patterns.push(stripGitignoreEscape(trimmed));
  }
  return patterns;
};
