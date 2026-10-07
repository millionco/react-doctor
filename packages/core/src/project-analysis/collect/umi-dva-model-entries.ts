import { readFileSync } from "node:fs";
import fg from "fast-glob";
import { maskJavaScriptStringsAndComments } from "../utils/mask-javascript-strings-and-comments.js";

const UMI_DEPENDENCIES = ["umi", "@umijs/max"];
const DVA_DEPENDENCIES = ["dva", "@umijs/plugin-dva"];
const UMI_CONFIG_PATTERNS = [
  ".umirc.{ts,tsx,js,jsx,mts,mjs,cts,cjs}",
  "config/config.{ts,tsx,js,jsx,mts,mjs,cts,cjs}",
  "config/config.*.{ts,tsx,js,jsx,mts,mjs,cts,cjs}",
];
const DVA_CONFIGURATION_PATTERN = /\bdva\s*:\s*(?:true|\{)/;

export const extractUmiDvaModelEntries = (
  directory: string,
  dependencies: Record<string, string>,
): string[] => {
  if (!UMI_DEPENDENCIES.some((dependencyName) => dependencyName in dependencies)) return [];

  let isDvaEnabled = DVA_DEPENDENCIES.some((dependencyName) => dependencyName in dependencies);
  if (!isDvaEnabled) {
    const configPaths = fg.sync(UMI_CONFIG_PATTERNS, {
      cwd: directory,
      absolute: true,
      onlyFiles: true,
    });
    isDvaEnabled = configPaths.some((configPath) => {
      try {
        const configContent = maskJavaScriptStringsAndComments(readFileSync(configPath, "utf-8"));
        return DVA_CONFIGURATION_PATTERN.test(configContent);
      } catch {
        return false;
      }
    });
  }
  if (!isDvaEnabled) return [];

  return fg.sync("src/models/**/*.{ts,tsx,js,jsx}", {
    cwd: directory,
    absolute: true,
    onlyFiles: true,
    ignore: ["**/node_modules/**"],
  });
};
