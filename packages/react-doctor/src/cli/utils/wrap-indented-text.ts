import { indentMultilineText } from "./indent-multiline-text.js";

const wrapLine = (lineText: string, contentWidth: number): string[] => {
  if (lineText.length <= contentWidth) return [lineText];

  const wrappedLines: string[] = [];
  let remainingText = lineText.trim();

  while (remainingText.length > contentWidth) {
    const candidateText = remainingText.slice(0, contentWidth);
    const breakIndex = candidateText.lastIndexOf(" ");

    if (breakIndex <= 0) {
      wrappedLines.push(candidateText);
      remainingText = remainingText.slice(contentWidth).trimStart();
      continue;
    }

    wrappedLines.push(remainingText.slice(0, breakIndex));
    remainingText = remainingText.slice(breakIndex + 1).trimStart();
  }

  if (remainingText.length > 0) {
    wrappedLines.push(remainingText);
  }

  return wrappedLines;
};

export const wrapIndentedText = (text: string, linePrefix: string, width: number): string => {
  const contentWidth = width - linePrefix.length;
  if (contentWidth <= 0) return indentMultilineText(text, linePrefix);

  return text
    .split("\n")
    .flatMap((lineText) => wrapLine(lineText, contentWidth))
    .map((lineText) => `${linePrefix}${lineText}`)
    .join("\n");
};
