import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

export const atomicWriteFile = (filePath: string, contents: string): void => {
  let temporaryPath: string | null = null;
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
    fs.writeFileSync(temporaryPath, contents);
    fs.renameSync(temporaryPath, filePath);
    temporaryPath = null;
  } catch {
    return;
  } finally {
    if (temporaryPath !== null) {
      try {
        fs.rmSync(temporaryPath, { force: true });
      } catch {}
    }
  }
};
