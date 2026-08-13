import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import fg from "fast-glob";
import { parseTOML } from "confbox";

const NETLIFY_FUNCTION_SOURCE_PATTERN = "**/*.{ts,tsx,js,jsx,mts,mjs,cts,cjs}";

export const extractNetlifyFunctionEntries = (projectRoot: string): string[] => {
  const configPath = resolve(projectRoot, "netlify.toml");
  if (!existsSync(configPath)) return [];

  let config: unknown;
  try {
    config = parseTOML<unknown>(readFileSync(configPath, "utf8"));
  } catch {
    return [];
  }
  const functionsConfig =
    config && typeof config === "object" && !Array.isArray(config) && "functions" in config
      ? config.functions
      : undefined;
  const configuredDirectory =
    functionsConfig &&
    typeof functionsConfig === "object" &&
    !Array.isArray(functionsConfig) &&
    "directory" in functionsConfig &&
    typeof functionsConfig.directory === "string"
      ? functionsConfig.directory
      : undefined;
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
