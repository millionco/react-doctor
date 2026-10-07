import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";

export const readNdjson = async function* (filePath: string): AsyncGenerator<unknown> {
  const input = createReadStream(filePath);
  const lines = createInterface({ input, crlfDelay: Infinity });
  let lineNumber = 0;
  try {
    for await (const line of lines) {
      lineNumber += 1;
      if (!line.trim()) continue;
      try {
        yield JSON.parse(line);
      } catch {
        throw new Error(`${filePath}:${lineNumber}: invalid JSON`);
      }
    }
  } finally {
    lines.close();
    input.destroy();
  }
};
