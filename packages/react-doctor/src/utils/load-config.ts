import fs from "node:fs";
import path from "node:path";
import type { ReactDoctorConfig } from "../types.js";
import { isFile } from "./is-file.js";
import { isPlainObject } from "./is-plain-object.js";
import { isMonorepoRoot } from "./find-monorepo-root.js";
import { logger } from "./logger.js";

const CONFIG_FILENAME = "react-doctor.config.json";
const PACKAGE_JSON_CONFIG_KEY = "reactDoctor";

const loadConfigFromDirectory = (directory: string): ReactDoctorConfig | null => {
  const configFilePath = path.join(directory, CONFIG_FILENAME);

  if (isFile(configFilePath)) {
    try {
      const fileContent = fs.readFileSync(configFilePath, "utf-8");
      const parsed: unknown = JSON.parse(fileContent);
      if (isPlainObject(parsed)) {
        return parsed as ReactDoctorConfig;
      }
      logger.warn(`${CONFIG_FILENAME} must be a JSON object, ignoring.`);
    } catch (error) {
      logger.warn(
        `Failed to parse ${CONFIG_FILENAME}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  const packageJsonPath = path.join(directory, "package.json");
  if (isFile(packageJsonPath)) {
    try {
      const fileContent = fs.readFileSync(packageJsonPath, "utf-8");
      const packageJson: unknown = JSON.parse(fileContent);
      if (isPlainObject(packageJson)) {
        const embeddedConfig = packageJson[PACKAGE_JSON_CONFIG_KEY];
        if (isPlainObject(embeddedConfig)) {
          return embeddedConfig as ReactDoctorConfig;
        }
      }
    } catch {
      return null;
    }
  }

  return null;
};

const isProjectBoundary = (directory: string): boolean => {
  if (isFile(path.join(directory, ".git"))) return true;
  if (fs.existsSync(path.join(directory, ".git"))) return true;
  return isMonorepoRoot(directory);
};

const cachedConfigs = new Map<string, ReactDoctorConfig | null>();

export const loadConfig = (rootDirectory: string): ReactDoctorConfig | null => {
  const cached = cachedConfigs.get(rootDirectory);
  if (cached !== undefined) return cached;

  const localConfig = loadConfigFromDirectory(rootDirectory);
  if (localConfig) {
    cachedConfigs.set(rootDirectory, localConfig);
    return localConfig;
  }

  if (isProjectBoundary(rootDirectory)) {
    cachedConfigs.set(rootDirectory, null);
    return null;
  }

  let ancestorDirectory = path.dirname(rootDirectory);
  while (ancestorDirectory !== path.dirname(ancestorDirectory)) {
    const ancestorConfig = loadConfigFromDirectory(ancestorDirectory);
    if (ancestorConfig) {
      cachedConfigs.set(rootDirectory, ancestorConfig);
      return ancestorConfig;
    }
    if (isProjectBoundary(ancestorDirectory)) {
      cachedConfigs.set(rootDirectory, null);
      return null;
    }
    ancestorDirectory = path.dirname(ancestorDirectory);
  }

  cachedConfigs.set(rootDirectory, null);
  return null;
};
