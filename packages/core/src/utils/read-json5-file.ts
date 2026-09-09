import { parseJSON, parseJSON5 } from "confbox";
import * as fs from "node:fs";

export const readJson5File = (filePath: string): unknown => {
  const sourceText = fs.readFileSync(filePath, "utf-8");
  if (sourceText.includes("\u2028") || sourceText.includes("\u2029")) return parseJSON5(sourceText);
  try {
    return parseJSON(sourceText);
  } catch {
    return parseJSON5(sourceText);
  }
};
