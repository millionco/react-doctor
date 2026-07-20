interface SourcePosition {
  readonly line: number;
  readonly column: number;
}

interface SourcePositionResolver {
  readonly resolve: (offset: number | undefined) => SourcePosition;
}

const buildLineStartOffsets = (sourceText: string): number[] => {
  const lineStartOffsets = [0];
  for (let sourceIndex = 0; sourceIndex < sourceText.length; sourceIndex += 1) {
    if (sourceText[sourceIndex] === "\n") lineStartOffsets.push(sourceIndex + 1);
  }
  return lineStartOffsets;
};

export const createSourcePositionResolver = (sourceText: string): SourcePositionResolver => {
  const lineStartOffsets = buildLineStartOffsets(sourceText);

  const resolve = (offset: number | undefined): SourcePosition => {
    const boundedOffset =
      typeof offset === "number" && Number.isFinite(offset) ? Math.max(0, Math.trunc(offset)) : 0;

    let lowIndex = 0;
    let highIndex = lineStartOffsets.length - 1;
    while (lowIndex <= highIndex) {
      const middleIndex = Math.floor((lowIndex + highIndex) / 2);
      if (lineStartOffsets[middleIndex]! <= boundedOffset) {
        lowIndex = middleIndex + 1;
      } else {
        highIndex = middleIndex - 1;
      }
    }
    const lineIndex = Math.max(0, highIndex);
    return {
      line: lineIndex + 1,
      column: boundedOffset - lineStartOffsets[lineIndex]!,
    };
  };

  return { resolve };
};
