import * as fs from "node:fs/promises";
import { resolveBoundedSourceReadBytes } from "./resolve-bounded-source-read-bytes.js";

export interface ReadTextFileUpToCharacterLimitInput {
  readonly filePath: string;
  readonly maximumLengthChars: number;
  readonly sizeBytes: number;
  readonly signal?: AbortSignal;
}

export const readTextFileUpToCharacterLimit = async (
  input: ReadTextFileUpToCharacterLimitInput,
): Promise<string> => {
  const buffer = Buffer.allocUnsafe(
    resolveBoundedSourceReadBytes(input.maximumLengthChars, input.sizeBytes),
  );
  const fileHandle = await fs.open(input.filePath, "r");
  let readOffset = 0;
  try {
    while (readOffset < buffer.length) {
      input.signal?.throwIfAborted();
      const { bytesRead } = await fileHandle.read(
        buffer,
        readOffset,
        buffer.length - readOffset,
        readOffset,
      );
      if (bytesRead === 0) break;
      readOffset += bytesRead;
    }
  } finally {
    await fileHandle.close();
  }
  input.signal?.throwIfAborted();
  return buffer.subarray(0, readOffset).toString("utf-8");
};
