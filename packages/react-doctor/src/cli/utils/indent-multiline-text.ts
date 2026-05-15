export const indentMultilineText = (text: string, linePrefix: string): string =>
  text
    .split("\n")
    .map((lineText) => `${linePrefix}${lineText}`)
    .join("\n");
