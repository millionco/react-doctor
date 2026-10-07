import type { Writable } from "node:stream";

import { createConcurrencyLimit } from "./create-concurrency-limit.js";
import { serializeNdjsonRecord } from "./serialize-ndjson-record.js";
import { writeWritableContents } from "./write-writable-contents.js";

export interface PairedNdjsonRecords {
  baselineRecord: unknown;
  treatmentRecord: unknown;
}

export interface CreatePairedNdjsonWriterInput {
  baselineFileHandle: PairedBaselineFile;
  treatmentOutput: Writable;
}

export interface PairedBaselineFile {
  write: (
    contents: Buffer,
    offset: number,
    length: number,
    position: number,
  ) => Promise<{ bytesWritten: number }>;
  truncate: (length?: number) => Promise<void>;
}

export interface PairedNdjsonWriter {
  (records: PairedNdjsonRecords): Promise<void>;
}

const writeFileContentsAtOffset = async (
  fileHandle: PairedBaselineFile,
  contents: Buffer,
  initialOffset: number,
): Promise<void> => {
  let writtenByteCount = 0;
  while (writtenByteCount < contents.byteLength) {
    const { bytesWritten } = await fileHandle.write(
      contents,
      writtenByteCount,
      contents.byteLength - writtenByteCount,
      initialOffset + writtenByteCount,
    );
    if (bytesWritten === 0) throw new Error("Failed to append paired baseline record");
    writtenByteCount += bytesWritten;
  }
};

export const createPairedNdjsonWriter = ({
  baselineFileHandle,
  treatmentOutput,
}: CreatePairedNdjsonWriterInput): PairedNdjsonWriter => {
  const limitWrite = createConcurrencyLimit(1);
  let baselineOffset = 0;
  let hasWriteFailed = false;
  let writeFailure: unknown;

  return (records) =>
    limitWrite(async () => {
      if (hasWriteFailed) throw writeFailure;
      const baselineContents = Buffer.from(serializeNdjsonRecord(records.baselineRecord));
      const treatmentContents = serializeNdjsonRecord(records.treatmentRecord);
      try {
        await writeFileContentsAtOffset(baselineFileHandle, baselineContents, baselineOffset);
        await writeWritableContents(treatmentOutput, treatmentContents);
      } catch (error) {
        try {
          await baselineFileHandle.truncate(baselineOffset);
        } catch (rollbackError) {
          writeFailure = new AggregateError(
            [error, rollbackError],
            "Failed to write a paired record and roll back its baseline",
          );
          hasWriteFailed = true;
          throw writeFailure;
        }
        writeFailure = error;
        hasWriteFailed = true;
        throw error;
      }
      baselineOffset += baselineContents.byteLength;
    });
};
