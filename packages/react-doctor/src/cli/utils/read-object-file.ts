import { parseJSON5 } from "confbox";
import { isPlainObject } from "@react-doctor/core";
import * as fs from "node:fs";

/**
 * Reads a JSON / JSONC file as a plain object, or `null` when it is missing,
 * unparseable, or not an object. JSON5 parsing tolerates comments and
 * trailing commas so hand-edited config files round-trip.
 */
export const readObjectFile = (filePath: string): Record<string, unknown> | null => {
  try {
    const parsed: unknown = parseJSON5(fs.readFileSync(filePath, "utf-8"));
    return isPlainObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
};
