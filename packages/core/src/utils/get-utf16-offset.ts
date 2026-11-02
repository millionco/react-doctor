export const getUtf16Offset = (sourceText: string, utf8Offset: number): number =>
  Buffer.from(sourceText).subarray(0, utf8Offset).toString("utf8").length;
