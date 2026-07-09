export interface LineDiffResult {
  readonly addedLines: number;
  readonly removedLines: number;
  readonly rawLinesChanged: number;
}

const splitLines = (sourceText: string): string[] => sourceText.split(/\r\n|\r|\n/);

export const calculateLineDiff = (
  firstSourceText: string,
  secondSourceText: string,
): LineDiffResult => {
  const firstLines = splitLines(firstSourceText);
  const secondLines = splitLines(secondSourceText);
  const rowCount = firstLines.length;
  const columnCount = secondLines.length;
  const lcsTable: number[][] = Array.from({ length: rowCount + 1 }, () =>
    Array.from({ length: columnCount + 1 }, () => 0),
  );

  for (let rowIndex = 1; rowIndex <= rowCount; rowIndex += 1) {
    for (let columnIndex = 1; columnIndex <= columnCount; columnIndex += 1) {
      if (firstLines[rowIndex - 1] === secondLines[columnIndex - 1]) {
        lcsTable[rowIndex]![columnIndex] = lcsTable[rowIndex - 1]![columnIndex - 1]! + 1;
      } else {
        lcsTable[rowIndex]![columnIndex] = Math.max(
          lcsTable[rowIndex - 1]![columnIndex]!,
          lcsTable[rowIndex]![columnIndex - 1]!,
        );
      }
    }
  }

  const lcsLength = lcsTable[rowCount]![columnCount]!;
  const removedLines = firstLines.length - lcsLength;
  const addedLines = secondLines.length - lcsLength;

  return {
    addedLines,
    removedLines,
    rawLinesChanged: addedLines + removedLines,
  };
};
