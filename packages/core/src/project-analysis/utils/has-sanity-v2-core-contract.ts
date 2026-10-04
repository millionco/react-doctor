import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { extractScriptBinaryNames } from "./extract-script-binary-names.js";

export const hasSanityV2CoreContract = (
  rootDirectory: string,
  scripts: Readonly<Record<string, unknown>>,
): boolean => {
  const manifestPath = join(rootDirectory, "sanity.json");
  if (!existsSync(manifestPath)) return false;
  if (
    !Object.values(scripts).some(
      (command) =>
        typeof command === "string" && extractScriptBinaryNames(command).includes("sanity"),
    )
  ) {
    return false;
  }
  try {
    return JSON.parse(readFileSync(manifestPath, "utf8")).root === true;
  } catch {
    return false;
  }
};
