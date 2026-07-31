import { once } from "node:events";
import type { Writable } from "node:stream";

export const writeNdjsonRecord = async (output: Writable, record: unknown): Promise<void> => {
  if (!output.write(`${JSON.stringify(record)}\n`)) {
    await once(output, "drain");
  }
};
