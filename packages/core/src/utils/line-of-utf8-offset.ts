import { LINE_FEED_UTF8_BYTE } from "../constants.js";

export const lineOfUtf8Offset = (
  sourceBuffer: Buffer,
  utf8Offset: number,
  newlineOffsetsBySource?: WeakMap<Buffer, ReadonlyArray<number>>,
): number => {
  if (newlineOffsetsBySource === undefined) {
    let lineNumber = 1;
    const scanEnd = Math.min(utf8Offset, sourceBuffer.length);
    for (let byteIndex = 0; byteIndex < scanEnd; byteIndex++) {
      if (sourceBuffer[byteIndex] === LINE_FEED_UTF8_BYTE) lineNumber++;
    }
    return lineNumber;
  }

  const scanEnd = Math.min(utf8Offset, sourceBuffer.length);
  if (!(scanEnd > 0)) return 1;
  let newlineOffsets = newlineOffsetsBySource.get(sourceBuffer);
  if (newlineOffsets === undefined) {
    const collectedOffsets: number[] = [];
    for (let byteIndex = 0; byteIndex < sourceBuffer.length; byteIndex++) {
      if (sourceBuffer[byteIndex] === LINE_FEED_UTF8_BYTE) collectedOffsets.push(byteIndex);
    }
    newlineOffsets = collectedOffsets;
    newlineOffsetsBySource.set(sourceBuffer, newlineOffsets);
  }

  let lowIndex = 0;
  let highIndex = newlineOffsets.length - 1;
  let newlinesBefore = 0;
  while (lowIndex <= highIndex) {
    const middleIndex = Math.floor((lowIndex + highIndex) / 2);
    if (newlineOffsets[middleIndex]! < scanEnd) {
      newlinesBefore = middleIndex + 1;
      lowIndex = middleIndex + 1;
    } else {
      highIndex = middleIndex - 1;
    }
  }
  return newlinesBefore + 1;
};
