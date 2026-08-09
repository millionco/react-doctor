import * as fs from "node:fs";
import * as path from "node:path";
import { isFile } from "./fs-utils.js";

export const NEXT_CONFIG_FILENAMES = [
  "next.config.js",
  "next.config.mjs",
  "next.config.ts",
  "next.config.cjs",
];

const STATIC_EXPORT_OUTPUT_PATTERN = /(?:^|[^.\w])["']?output["']?\s*:\s*["']export["']/m;

export const detectNextjsStaticExport = (directory: string): boolean =>
  NEXT_CONFIG_FILENAMES.some((filename) => {
    const filePath = path.join(directory, filename);
    return (
      isFile(filePath) && STATIC_EXPORT_OUTPUT_PATTERN.test(fs.readFileSync(filePath, "utf-8"))
    );
  });
