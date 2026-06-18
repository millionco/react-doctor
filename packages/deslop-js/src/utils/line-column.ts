export const getLineFromOffset = (source: string, offset: number): number => {
  let line = 1;
  for (let charIndex = 0; charIndex < offset && charIndex < source.length; charIndex++) {
    if (source[charIndex] === "\n") {
      line++;
    }
  }
  return line;
};

export const getColumnFromOffset = (source: string, offset: number): number => {
  let column = 0;
  for (let charIndex = offset - 1; charIndex >= 0; charIndex--) {
    if (source[charIndex] === "\n") break;
    column++;
  }
  return column;
};
