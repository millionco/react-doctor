import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import fg from "fast-glob";

const NETLIFY_FUNCTION_SOURCE_PATTERN = "**/*.{ts,tsx,js,jsx,mts,mjs,cts,cjs}";
const NETLIFY_FUNCTIONS_SECTION_PATTERN = /^\s*\[functions\]\s*$([\s\S]*?)(?=^\s*\[|(?![\s\S]))/m;
const NETLIFY_FUNCTIONS_DIRECTORY_PATTERN = /^\s*directory\s*=\s*["']([^"']+)["']/m;

export const extractNetlifyFunctionEntries = (projectRoot: string): string[] => {
  const configPath = resolve(projectRoot, "netlify.toml");
  if (!existsSync(configPath)) return [];

  let configSource: string;
  try {
    configSource = readFileSync(configPath, "utf8");
  } catch {
    return [];
  }
  const functionsSection = configSource.match(NETLIFY_FUNCTIONS_SECTION_PATTERN)?.[1];
  const configuredDirectory = functionsSection?.match(NETLIFY_FUNCTIONS_DIRECTORY_PATTERN)?.[1];
  const functionsDirectory = resolve(
    dirname(configPath),
    configuredDirectory ?? "netlify/functions",
  );
  if (!existsSync(functionsDirectory)) return [];

  return fg.sync(NETLIFY_FUNCTION_SOURCE_PATTERN, {
    cwd: functionsDirectory,
    absolute: true,
    onlyFiles: true,
    ignore: ["**/node_modules/**"],
  });
};
