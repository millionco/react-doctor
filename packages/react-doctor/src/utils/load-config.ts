import fs from "node:fs";
import path from "node:path";
import type { ReactDoctorConfig } from "../types.js";
import { findMonorepoRoot } from "./find-monorepo-root.js";
import { isFile } from "./is-file.js";
import { isPlainObject } from "./is-plain-object.js";

const CONFIG_FILENAME = "react-doctor.config.json";
const PACKAGE_JSON_CONFIG_KEY = "reactDoctor";

const loadDirectoryConfig = (directory: string): ReactDoctorConfig | null => {
  const configFilePath = path.join(directory, CONFIG_FILENAME);

  if (isFile(configFilePath)) {
    try {
      const fileContent = fs.readFileSync(configFilePath, "utf-8");
      const parsed: unknown = JSON.parse(fileContent);
      if (isPlainObject(parsed)) {
        return parsed as ReactDoctorConfig;
      }
      console.warn(`Warning: ${CONFIG_FILENAME} must be a JSON object, ignoring.`);
    } catch (error) {
      console.warn(
        `Warning: Failed to parse ${CONFIG_FILENAME}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  const packageJsonPath = path.join(directory, "package.json");
  if (isFile(packageJsonPath)) {
    try {
      const fileContent = fs.readFileSync(packageJsonPath, "utf-8");
      const packageJson = JSON.parse(fileContent);
      const embeddedConfig = packageJson[PACKAGE_JSON_CONFIG_KEY];
      if (isPlainObject(embeddedConfig)) {
        return embeddedConfig as ReactDoctorConfig;
      }
    } catch {
      return null;
    }
  }

  return null;
};

export const loadConfig = (rootDirectory: string): ReactDoctorConfig | null => {
  const localConfig = loadDirectoryConfig(rootDirectory);
  if (localConfig) {
    return localConfig;
  }

  const monorepoRoot = findMonorepoRoot(rootDirectory);
  if (!monorepoRoot || monorepoRoot === rootDirectory) {
    return null;
  }

  return loadDirectoryConfig(monorepoRoot);
};
