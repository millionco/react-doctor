import * as fs from "node:fs";
import * as path from "node:path";
import { isFile } from "./utils/is-file.js";

const NEXT_CONFIG_FILENAMES = [
  "next.config.js",
  "next.config.mjs",
  "next.config.ts",
  "next.config.cjs",
];

const OUTPUT_EXPORT_PATTERN = /["']?output["']?\s*:\s*["']export["']/;

const hasStaticExportInConfigFile = (filePath: string): boolean => {
  if (!isFile(filePath)) return false;
  const content = fs.readFileSync(filePath, "utf-8");
  return OUTPUT_EXPORT_PATTERN.test(content);
};

export const detectNextjsStaticExport = (directory: string): boolean =>
  NEXT_CONFIG_FILENAMES.some((filename) =>
    hasStaticExportInConfigFile(path.join(directory, filename)),
  );
