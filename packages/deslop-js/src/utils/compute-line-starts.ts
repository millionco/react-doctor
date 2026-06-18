const LINE_FEED_CHAR_CODE = 10;

export const computeLineStarts = (sourceText: string): number[] => {
  const lineStarts: number[] = [0];
  for (let charIndex = 0; charIndex < sourceText.length; charIndex++) {
    if (sourceText.charCodeAt(charIndex) === LINE_FEED_CHAR_CODE) lineStarts.push(charIndex + 1);
  }
  return lineStarts;
};
