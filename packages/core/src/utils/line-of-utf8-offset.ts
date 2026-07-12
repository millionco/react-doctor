import { LINE_FEED_UTF8_BYTE } from "../constants.js";

export const lineOfUtf8Offset = (sourceBuffer: Buffer, utf8Offset: number): number => {
  let lineNumber = 1;
  const scanEnd = Math.min(utf8Offset, sourceBuffer.length);
  for (let byteIndex = 0; byteIndex < scanEnd; byteIndex++) {
    if (sourceBuffer[byteIndex] === LINE_FEED_UTF8_BYTE) lineNumber++;
  }
  return lineNumber;
};
