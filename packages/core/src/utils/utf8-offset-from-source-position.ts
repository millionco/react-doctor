export const utf8OffsetFromSourcePosition = (
  sourceBuffer: Buffer,
  lineNumber: number,
  zeroBasedColumn: number,
): number | null => {
  if (lineNumber < 1 || zeroBasedColumn < 0) return null;
  const sourceLines = sourceBuffer.toString("utf8").split("\n");
  const sourceLine = sourceLines[lineNumber - 1];
  if (sourceLine === undefined || zeroBasedColumn > sourceLine.length) return null;
  const precedingLines = sourceLines.slice(0, lineNumber - 1).join("\n");
  const precedingLineBytes =
    lineNumber === 1 ? 0 : Buffer.byteLength(precedingLines) + Buffer.byteLength("\n");
  return precedingLineBytes + Buffer.byteLength(sourceLine.slice(0, zeroBasedColumn));
};
