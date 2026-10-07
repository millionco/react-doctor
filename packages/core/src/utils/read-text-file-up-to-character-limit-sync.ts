import * as fs from "node:fs";
import { resolveBoundedSourceReadBytes } from "./resolve-bounded-source-read-bytes.js";

export interface ReadTextFileUpToCharacterLimitSyncInput {
  readonly filePath: string;
  readonly maximumLengthChars: number;
  readonly sizeBytes: number;
}

export const readTextFileUpToCharacterLimitSync = (
  input: ReadTextFileUpToCharacterLimitSyncInput,
): string => {
  const buffer = Buffer.allocUnsafe(
    resolveBoundedSourceReadBytes(input.maximumLengthChars, input.sizeBytes),
  );
  const fileDescriptor = fs.openSync(input.filePath, "r");
  let readOffset = 0;
  try {
    while (readOffset < buffer.length) {
      const bytesRead = fs.readSync(
        fileDescriptor,
        buffer,
        readOffset,
        buffer.length - readOffset,
        readOffset,
      );
      if (bytesRead === 0) break;
      readOffset += bytesRead;
    }
  } finally {
    fs.closeSync(fileDescriptor);
  }
  return buffer.subarray(0, readOffset).toString("utf-8");
};
