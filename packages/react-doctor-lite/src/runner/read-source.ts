import * as fs from "node:fs";
import type { LiteSource } from "../types.js";

// Reads a file into a `LiteSource`, returning `null` when the read fails so
// the caller can simply skip unreadable paths.
export const readSource = (filePath: string): LiteSource | null => {
  try {
    return { filePath, code: fs.readFileSync(filePath, "utf8") };
  } catch {
    return null;
  }
};
