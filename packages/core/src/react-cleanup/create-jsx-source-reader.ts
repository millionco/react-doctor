import * as fs from "node:fs";
import * as fsPromises from "node:fs/promises";
import * as path from "node:path";
import type { SourceFileEntry } from "../types/index.js";
import { readTextFileUpToCharacterLimitSync } from "../utils/read-text-file-up-to-character-limit-sync.js";
import { readTextFileUpToCharacterLimit } from "../utils/read-text-file-up-to-character-limit.js";
import type { JsxDuplicationSourceReader } from "./detect-duplicate-jsx-subtrees.js";

export interface CreateJsxSourceReaderInput {
  readonly rootDirectory: string;
  readonly sourceFiles: ReadonlyArray<SourceFileEntry>;
  readonly signal?: AbortSignal;
  /**
   * Read on the calling thread instead of the libuv threadpool. Only safe on a
   * dedicated worker thread, where it removes a threadpool round trip per file.
   */
  readonly useBlockingReads?: boolean;
}

const readBlocking = (
  absolutePath: string,
  maximumLengthChars: number,
  sizeBytes: number,
): Promise<string> =>
  new Promise((resolve) => {
    resolve(
      sizeBytes <= maximumLengthChars
        ? fs.readFileSync(absolutePath, "utf-8")
        : readTextFileUpToCharacterLimitSync({
            filePath: absolutePath,
            maximumLengthChars,
            sizeBytes,
          }),
    );
  });

export const createJsxSourceReader = (
  input: CreateJsxSourceReaderInput,
): JsxDuplicationSourceReader => {
  const sourceSizeByPath = new Map(
    input.sourceFiles.map((sourceFile) => [sourceFile.path, sourceFile.sizeBytes]),
  );
  return {
    paths: [...sourceSizeByPath.keys()],
    read: (filePath, maximumLengthChars) => {
      const absolutePath = path.resolve(input.rootDirectory, filePath);
      const sourceSizeBytes = sourceSizeByPath.get(filePath) ?? 0;
      if (input.useBlockingReads === true) {
        return readBlocking(absolutePath, maximumLengthChars, sourceSizeBytes);
      }
      return sourceSizeBytes <= maximumLengthChars
        ? fsPromises.readFile(absolutePath, { encoding: "utf-8", signal: input.signal })
        : readTextFileUpToCharacterLimit({
            filePath: absolutePath,
            maximumLengthChars,
            sizeBytes: sourceSizeBytes,
            signal: input.signal,
          });
    },
  };
};
