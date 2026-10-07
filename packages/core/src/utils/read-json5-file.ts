import { parseJSON5 } from "confbox";
import * as fs from "node:fs";

// Strict JSON is the common case (every package.json) and `JSON.parse` is
// native; the JSON5 parser walks the text character by character in JS and
// costs ~90ms cold on a 4 KB manifest, so it only runs for comments/trailing
// commas that strict parsing rejects.
export const readJson5File = (filePath: string): unknown => {
  const source = fs.readFileSync(filePath, "utf-8");
  try {
    return JSON.parse(source);
  } catch {
    return parseJSON5(source);
  }
};
