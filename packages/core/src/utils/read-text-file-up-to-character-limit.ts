import * as fs from "node:fs/promises";
import {
  JSX_DUPLICATION_SOURCE_READ_SENTINEL_BYTES,
  UTF8_MAX_BYTES_PER_UTF16_CODE_UNIT,
} from "../constants.js";

export interface ReadTextFileUpToCharacterLimitInput {
  readonly filePath: string;
  readonly maximumLengthChars: number;
  readonly sizeBytes: number;
  readonly signal?: AbortSignal;
}

export const readTextFileUpToCharacterLimit = async (
  input: ReadTextFileUpToCharacterLimitInput,
): Promise<string> => {
  const maximumReadBytes =
    input.maximumLengthChars * UTF8_MAX_BYTES_PER_UTF16_CODE_UNIT +
    JSX_DUPLICATION_SOURCE_READ_SENTINEL_BYTES;
  const buffer = Buffer.allocUnsafe(Math.min(input.sizeBytes, maximumReadBytes));
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
