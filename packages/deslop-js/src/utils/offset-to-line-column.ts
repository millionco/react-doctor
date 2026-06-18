export interface LineColumn {
  line: number;
  column: number;
}

export const offsetToLineColumn = (byteOffset: number, lineStarts: number[]): LineColumn => {
  let lowIndex = 0;
  let highIndex = lineStarts.length - 1;
  while (lowIndex < highIndex) {
    const middleIndex = (lowIndex + highIndex + 1) >>> 1;
    if (lineStarts[middleIndex] <= byteOffset) lowIndex = middleIndex;
    else highIndex = middleIndex - 1;
  }
  return { line: lowIndex + 1, column: byteOffset - lineStarts[lowIndex] };
};
