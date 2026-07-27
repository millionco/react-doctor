interface SourcePosition {
  readonly line: number;
  readonly column: number;
}

export const getSourcePosition = (sourceText: string, sourceIndex: number): SourcePosition => {
  const boundedSourceIndex = Math.max(0, Math.min(sourceIndex, sourceText.length));
  let line = 1;
  let lineStartIndex = 0;
  for (let index = 0; index < boundedSourceIndex; index++) {
    const character = sourceText[index];
    if (character === "\n") {
      line++;
      lineStartIndex = index + 1;
      continue;
    }
    if (character === "\r" && sourceText[index + 1] !== "\n") {
      line++;
      lineStartIndex = index + 1;
    }
  }
  return {
    line,
    column: Buffer.byteLength(sourceText.slice(lineStartIndex, boundedSourceIndex)) + 1,
  };
};
