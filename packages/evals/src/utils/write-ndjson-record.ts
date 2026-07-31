import type { Writable } from "node:stream";

import { serializeNdjsonRecord } from "./serialize-ndjson-record.js";
import { writeWritableContents } from "./write-writable-contents.js";

export const writeNdjsonRecord = async (output: Writable, record: unknown): Promise<void> => {
  await writeWritableContents(output, serializeNdjsonRecord(record));
};
