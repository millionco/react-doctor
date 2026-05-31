import { indentMultilineText } from "./indent-multiline-text.js";

interface WrapTextOptions {
  /**
   * When `true` (the default), a single word longer than `width` is
   * hard-split so no line ever exceeds the width. When `false`, such a
   * word is kept intact on its own line (which can exceed the width) so
   * URLs and identifiers stay copy-pasteable.
   */
  readonly breakLongWords?: boolean;
}

const wrapLine = (lineText: string, width: number, breakLongWords: boolean): string[] => {
  if (lineText.length <= width) return [lineText];

  const wrappedLines: string[] = [];
  let remainingText = lineText.trim();

  while (remainingText.length > width) {
    const candidateText = remainingText.slice(0, width);
    const breakIndex = candidateText.lastIndexOf(" ");

    if (breakIndex <= 0) {
      // The leading word is wider than the limit.
      if (breakLongWords) {
        wrappedLines.push(candidateText);
        remainingText = remainingText.slice(width).trimStart();
        continue;
      }
      const nextSpace = remainingText.indexOf(" ");
      if (nextSpace === -1) break; // whole remainder is one long word
      wrappedLines.push(remainingText.slice(0, nextSpace));
      remainingText = remainingText.slice(nextSpace + 1).trimStart();
      continue;
    }

    wrappedLines.push(remainingText.slice(0, breakIndex));
    remainingText = remainingText.slice(breakIndex + 1).trimStart();
  }

  if (remainingText.length > 0) wrappedLines.push(remainingText);
  return wrappedLines;
};

/**
 * Greedy word-wrap to a character width, returning one string per line
 * (no indentation applied). Preserves existing `\n` boundaries.
 */
export const wrapTextToWidth = (
  text: string,
  width: number,
  options: WrapTextOptions = {},
): string[] => {
  if (width <= 0) return text.split("\n");
  const breakLongWords = options.breakLongWords ?? true;
  return text.split("\n").flatMap((lineText) => wrapLine(lineText, width, breakLongWords));
};

export const wrapIndentedText = (text: string, linePrefix: string, width: number): string => {
  const contentWidth = width - linePrefix.length;
  if (contentWidth <= 0) return indentMultilineText(text, linePrefix);

  return wrapTextToWidth(text, contentWidth)
    .map((lineText) => `${linePrefix}${lineText}`)
    .join("\n");
};
