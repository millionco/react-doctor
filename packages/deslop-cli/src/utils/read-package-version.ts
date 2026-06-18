import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const isPackageJsonWithVersion = (value: unknown): value is { version: string } =>
  typeof value === "object" &&
  value !== null &&
  "version" in value &&
  typeof value.version === "string";

export const readPackageVersion = (moduleUrl: string): string => {
  const currentDirectory = dirname(fileURLToPath(moduleUrl));
  const packageJsonPath = resolve(currentDirectory, "../package.json");
  const parsedJson: unknown = JSON.parse(readFileSync(packageJsonPath, "utf-8"));

  if (!isPackageJsonWithVersion(parsedJson)) {
    throw new Error(`Invalid package.json at ${packageJsonPath}: missing version field`);
  }

  return parsedJson.version;
};
