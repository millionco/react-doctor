import fs from "node:fs";
import path from "node:path";
import type { ReactDoctorConfig } from "../types/config.js";
import { isFile } from "./is-file.js";
import { isPlainObject } from "./is-plain-object.js";
import { isMonorepoRoot } from "./find-monorepo-root.js";
import { logger } from "./logger.js";
import { validateConfigTypes } from "./validate-config-types.js";

const CONFIG_FILENAME = "react-doctor.config.json";
const PACKAGE_JSON_CONFIG_KEY = "reactDoctor";

interface LoadedReactDoctorConfig {
  config: ReactDoctorConfig;
  /**
   * Absolute path of the directory that contained the resolved config
   * file (or `package.json` with the `reactDoctor` key). Path-valued
   * config fields like `rootDir` are resolved relative to this
   * directory, never the CWD.
   */
  sourceDirectory: string;
}

const loadConfigFromDirectory = (directory: string): LoadedReactDoctorConfig | null => {
  const configFilePath = path.join(directory, CONFIG_FILENAME);

  if (isFile(configFilePath)) {
    try {
      const fileContent = fs.readFileSync(configFilePath, "utf-8");
      const parsed: unknown = JSON.parse(fileContent);
      if (isPlainObject(parsed)) {
        return {
          config: validateConfigTypes(parsed as ReactDoctorConfig),
          sourceDirectory: directory,
        };
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
          return {
            config: validateConfigTypes(embeddedConfig as ReactDoctorConfig),
            sourceDirectory: directory,
          };
        }
      }
    } catch {
      return null;
    }
  }

  return null;
};

// HACK: `.git` exists either as a directory (regular repo) or a file
// (git worktree pointing back to the main .git dir). `fs.existsSync`
// covers both — no need for a separate `isFile` check.
const isProjectBoundary = (directory: string): boolean =>
  fs.existsSync(path.join(directory, ".git")) || isMonorepoRoot(directory);

const cachedConfigs = new Map<string, LoadedReactDoctorConfig | null>();

// HACK: expose a way to clear the module-level config cache so programmatic
// API consumers (watch-mode tools, test runners, agentic CLI flows) can
// re-detect after the user edits react-doctor.config.json or package.json
// between calls. The cache is keyed by absolute directory; without a
// cache-clear hook, repeated diagnose() calls would always hit the stale
// first-resolution result.
export const clearConfigCache = (): void => {
  cachedConfigs.clear();
};

export const loadConfigWithSource = (rootDirectory: string): LoadedReactDoctorConfig | null => {
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

export const loadConfig = (rootDirectory: string): ReactDoctorConfig | null =>
  loadConfigWithSource(rootDirectory)?.config ?? null;
