import { LINE_FEED_UTF8_BYTE } from "../constants.js";

export const columnOfUtf8Offset = (sourceBuffer: Buffer, utf8Offset: number): number => {
  const boundedOffset = Math.min(Math.max(utf8Offset, 0), sourceBuffer.length);
  let lineStartOffset = boundedOffset;
  while (lineStartOffset > 0 && sourceBuffer[lineStartOffset - 1] !== LINE_FEED_UTF8_BYTE) {
    lineStartOffset--;
  }
  return sourceBuffer.subarray(lineStartOffset, boundedOffset).toString("utf8").length + 1;
};
