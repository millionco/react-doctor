import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import fs from "node:fs";
import path from "node:path";
import { parseJSON5 } from "confbox";
import { createJiti } from "jiti";
import type { ReactDoctorConfig } from "./types/index.js";
import { isFile, isPlainObject } from "./project-info/index.js";
import { isProjectBoundary } from "./utils/is-project-boundary.js";
import { validateConfigTypes } from "./validate-config-types.js";

const warn = (message: string): void => {
  Effect.runSync(Console.warn(message));
};

const CONFIG_BASENAME = "doctor.config";
// TS-first, then the other module formats, then data formats. The first
// match in a directory wins.
const CONFIG_EXTENSIONS = ["ts", "mts", "cts", "js", "mjs", "cjs", "json", "jsonc"] as const;
const DATA_CONFIG_EXTENSIONS: ReadonlySet<string> = new Set(["json", "jsonc"]);
const PACKAGE_JSON_FILENAME = "package.json";
const PACKAGE_JSON_CONFIG_KEY = "reactDoctor";
const LEGACY_CONFIG_FILENAME = "react-doctor.config.json";

/**
 * Coarse format of the resolved config, used by the rule-config writer
 * to decide how to edit it: `module` (TS/JS — edited via magicast),
 * `json` (data file), or `package-json` (the `reactDoctor` key).
 */
export type ReactDoctorConfigFormat = "module" | "json" | "package-json";

export interface LoadedReactDoctorConfig {
  config: ReactDoctorConfig;
  /**
   * Absolute path of the directory that contained the resolved config.
   * Path-valued config fields like `rootDir` are resolved relative to
   * this directory, never the CWD.
   */
  sourceDirectory: string;
  /** Absolute path of the config file (the `package.json` when embedded). */
  configFilePath: string;
  format: ReactDoctorConfigFormat;
}

// Per-directory lookup outcome. `invalid` means a `doctor.config.*` file is
// present but unparseable / not an object — an explicit-but-broken config
// that must NOT fall through to an ancestor repo's config.
interface DirectoryConfigResult {
  readonly status: "found" | "absent" | "invalid";
  readonly loaded: LoadedReactDoctorConfig | null;
}

// One jiti instance, reused across loads so its transform cache is warm.
const jiti = createJiti(import.meta.url);

const formatError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const loadModuleConfig = async (filePath: string): Promise<unknown> => {
  const imported = await jiti.import<{ default?: unknown }>(filePath);
  return imported?.default ?? imported;
};

// JSON5 is a strict superset of JSON: it allows comments and trailing
// commas (the "JSONC" features), but still throws on genuinely malformed
// input so a broken config is detected rather than silently recovered.
const readDataConfig = (filePath: string): unknown =>
  parseJSON5(fs.readFileSync(filePath, "utf-8"));

// Reads the `reactDoctor` config object embedded in a directory's
// package.json, or null when it's absent or malformed. A malformed
// package.json is not ours to police, so it reads as "no embedded config".
const readEmbeddedPackageJsonConfig = (directory: string): Record<string, unknown> | null => {
  const packageJsonPath = path.join(directory, PACKAGE_JSON_FILENAME);
  if (!isFile(packageJsonPath)) return null;
  try {
    const packageJson = parseJSON5(fs.readFileSync(packageJsonPath, "utf-8"));
    if (isPlainObject(packageJson)) {
      const embeddedConfig = packageJson[PACKAGE_JSON_CONFIG_KEY];
      if (isPlainObject(embeddedConfig)) return embeddedConfig;
    }
  } catch {
    // Keep resolving.
  }
  return null;
};

const loadPackageJsonConfig = (directory: string): LoadedReactDoctorConfig | null => {
  const embeddedConfig = readEmbeddedPackageJsonConfig(directory);
  if (!embeddedConfig) return null;
  return {
    config: validateConfigTypes(embeddedConfig as ReactDoctorConfig),
    sourceDirectory: directory,
    configFilePath: path.join(directory, PACKAGE_JSON_FILENAME),
    format: "package-json",
  };
};

const loadConfigFromDirectory = async (directory: string): Promise<DirectoryConfigResult> => {
  let sawBrokenConfigFile = false;
  for (const extension of CONFIG_EXTENSIONS) {
    const filePath = path.join(directory, `${CONFIG_BASENAME}.${extension}`);
    if (!isFile(filePath)) continue;
    const isDataFile = DATA_CONFIG_EXTENSIONS.has(extension);
    try {
      const parsed = isDataFile ? readDataConfig(filePath) : await loadModuleConfig(filePath);
      if (isPlainObject(parsed)) {
        return {
          status: "found",
          loaded: {
            config: validateConfigTypes(parsed as ReactDoctorConfig),
            sourceDirectory: directory,
            configFilePath: filePath,
            format: isDataFile ? "json" : "module",
          },
        };
      }
      warn(`${CONFIG_BASENAME}.${extension} must export an object, ignoring.`);
      sawBrokenConfigFile = true;
    } catch (error) {
      warn(`Failed to load ${CONFIG_BASENAME}.${extension}: ${formatError(error)}`);
      sawBrokenConfigFile = true;
    }
  }

  const packageJsonConfig = loadPackageJsonConfig(directory);
  if (packageJsonConfig) return { status: "found", loaded: packageJsonConfig };

  // Nudge users who still have the pre-migration filename — it's no longer
  // read, so without this warning the config would silently stop applying.
  if (isFile(path.join(directory, LEGACY_CONFIG_FILENAME))) {
    warn(
      `${LEGACY_CONFIG_FILENAME} is no longer read — rename it to ${CONFIG_BASENAME}.json (or author a ${CONFIG_BASENAME}.ts).`,
    );
  }
  return { status: sawBrokenConfigFile ? "invalid" : "absent", loaded: null };
};

// HACK: expose a way to clear the module-level config cache so programmatic
// API consumers (watch-mode tools, test runners, agentic CLI flows) can
// re-detect after the user edits a config between calls. The cache is keyed
// by absolute directory and stores the in-flight promise so concurrent
// lookups dedupe; without a cache-clear hook, repeated diagnose() calls
// would always hit the stale first-resolution result.
const cachedConfigs = new Map<string, Promise<LoadedReactDoctorConfig | null>>();

export const clearConfigCache = (): void => {
  cachedConfigs.clear();
};

const loadConfigWalkingUp = async (
  rootDirectory: string,
): Promise<LoadedReactDoctorConfig | null> => {
  const localResult = await loadConfigFromDirectory(rootDirectory);
  if (localResult.status === "found") return localResult.loaded;
  // A present-but-unparseable config at the requested root is an explicit
  // (broken) config. Stop here rather than walking up and silently governing
  // this project with a parent repo's config.
  if (localResult.status === "invalid" || isProjectBoundary(rootDirectory)) return null;

  let ancestorDirectory = path.dirname(rootDirectory);
  while (ancestorDirectory !== path.dirname(ancestorDirectory)) {
    const ancestorResult = await loadConfigFromDirectory(ancestorDirectory);
    if (ancestorResult.status === "found") return ancestorResult.loaded;
    if (isProjectBoundary(ancestorDirectory)) return null;
    ancestorDirectory = path.dirname(ancestorDirectory);
  }
  return null;
};

export const loadConfigWithSource = (
  rootDirectory: string,
): Promise<LoadedReactDoctorConfig | null> => {
  const cached = cachedConfigs.get(rootDirectory);
  if (cached !== undefined) return cached;
  const loadPromise = loadConfigWalkingUp(rootDirectory);
  cachedConfigs.set(rootDirectory, loadPromise);
  return loadPromise;
};

export interface LegacyConfigLocation {
  /** Absolute path of the pre-migration `react-doctor.config.json`. */
  readonly legacyFilePath: string;
  /** Directory that contains it (where the migrated file should land). */
  readonly directory: string;
}

// True when the directory already has a current-format config — a
// `doctor.config.*` file (parseable or not) or a `package.json#reactDoctor`
// key. Such a config supersedes any sibling legacy file, so there's nothing
// to migrate. Kept side-effect-free (no `validateConfigTypes`) so the
// detection walk never emits warnings.
const directoryHasCurrentConfig = (directory: string): boolean => {
  for (const extension of CONFIG_EXTENSIONS) {
    if (isFile(path.join(directory, `${CONFIG_BASENAME}.${extension}`))) return true;
  }
  return readEmbeddedPackageJsonConfig(directory) !== null;
};

/**
 * Walks up from `rootDirectory` (same boundary semantics as
 * `loadConfigWithSource`) looking for a pre-migration
 * `react-doctor.config.json` that is no longer read. Returns the first one
 * found, or `null` when a current-format config supersedes it or none exists
 * before a project boundary. Detection only — the CLI performs the rename.
 */
export const findLegacyConfig = (rootDirectory: string): LegacyConfigLocation | null => {
  let directory = rootDirectory;
  while (true) {
    if (directoryHasCurrentConfig(directory)) return null;
    const legacyFilePath = path.join(directory, LEGACY_CONFIG_FILENAME);
    if (isFile(legacyFilePath)) return { legacyFilePath, directory };
    if (isProjectBoundary(directory)) return null;
    const parentDirectory = path.dirname(directory);
    if (parentDirectory === directory) return null;
    directory = parentDirectory;
  }
};
