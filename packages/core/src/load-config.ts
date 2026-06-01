import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import fs from "node:fs";
import path from "node:path";
import type { ReactDoctorConfig } from "./types/index.js";
import { isFile, isPlainObject } from "./project-info/index.js";
import { isProjectBoundary } from "./utils/is-project-boundary.js";
import { validateConfigTypes } from "./validate-config-types.js";

const warn = (message: string): void => {
  Effect.runSync(Console.warn(message));
};

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

interface ConfigLookupResult {
  // "found": a usable config was parsed in this directory.
  // "absent": no react-doctor config exists in this directory.
  // "invalid": a `react-doctor.config.json` is present but unparseable or
  //   not a JSON object — an explicit-but-broken config that must NOT fall
  //   through to an ancestor's config.
  status: "found" | "absent" | "invalid";
  loaded: LoadedReactDoctorConfig | null;
}

const loadConfigFromDirectory = (directory: string): ConfigLookupResult => {
  const configFilePath = path.join(directory, CONFIG_FILENAME);

  // A present-but-unusable `react-doctor.config.json` still falls back to a
  // `package.json` config in the SAME directory (same project), but the
  // broken file is remembered so an ancestor repo's config never silently
  // governs this project.
  let sawBrokenConfigFile = false;
  if (isFile(configFilePath)) {
    try {
      const fileContent = fs.readFileSync(configFilePath, "utf-8");
      const parsed: unknown = JSON.parse(fileContent);
      if (isPlainObject(parsed)) {
        return {
          status: "found",
          loaded: {
            config: validateConfigTypes(parsed as ReactDoctorConfig),
            sourceDirectory: directory,
          },
        };
      }
      warn(`${CONFIG_FILENAME} must be a JSON object, ignoring.`);
    } catch (error) {
      warn(
        `Failed to parse ${CONFIG_FILENAME}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    sawBrokenConfigFile = true;
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
            status: "found",
            loaded: {
              config: validateConfigTypes(embeddedConfig as ReactDoctorConfig),
              sourceDirectory: directory,
            },
          };
        }
      }
    } catch {
      // A malformed package.json is not our file to police; treat it as
      // "no embedded config here" and keep resolving.
    }
  }

  return { status: sawBrokenConfigFile ? "invalid" : "absent", loaded: null };
};

// HACK: `.git` exists either as a directory (regular repo) or a file
// (git worktree pointing back to the main .git dir). `fs.existsSync`
// covers both — no need for a separate `isFile` check.
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

  const localResult = loadConfigFromDirectory(rootDirectory);
  if (localResult.status === "found") {
    cachedConfigs.set(rootDirectory, localResult.loaded);
    return localResult.loaded;
  }

  // A present-but-unparseable config at the requested root is an explicit
  // (broken) config. Stop here rather than walking up and silently governing
  // this project with a parent repo's config.
  if (localResult.status === "invalid" || isProjectBoundary(rootDirectory)) {
    cachedConfigs.set(rootDirectory, null);
    return null;
  }

  let ancestorDirectory = path.dirname(rootDirectory);
  while (ancestorDirectory !== path.dirname(ancestorDirectory)) {
    const ancestorResult = loadConfigFromDirectory(ancestorDirectory);
    if (ancestorResult.status === "found") {
      cachedConfigs.set(rootDirectory, ancestorResult.loaded);
      return ancestorResult.loaded;
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
