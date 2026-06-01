import { createHash } from "node:crypto";
import path from "node:path";
import Conf from "conf";
import { findNearestPackageDirectory, hasDoctorScript } from "./install-doctor-script.js";
import { isCodingAgentEnvironment } from "./is-ci-environment.js";

export interface SetupPitchWriter {
  (line?: string): void;
}

export interface SetupPromptStoreOptions {
  readonly cwd?: string;
}

interface SetupPromptProjectConfig {
  readonly rootDirectory: string;
  readonly setupPrompt?: false;
}

interface SetupPromptGlobalConfig {
  readonly projects?: Record<string, SetupPromptProjectConfig>;
}

export interface ResolveInstallSetupProjectRootOptions {
  readonly scanRoot: string;
  readonly scanDirectories: ReadonlyArray<string>;
}

const GLOBAL_CONFIG_PROJECT_NAME = "react-doctor";

const getSetupPromptStore = (
  options: SetupPromptStoreOptions = {},
): Conf<SetupPromptGlobalConfig> =>
  new Conf<SetupPromptGlobalConfig>({
    projectName: GLOBAL_CONFIG_PROJECT_NAME,
    cwd: options.cwd,
  });

export const getSetupPromptConfigPath = (options: SetupPromptStoreOptions = {}): string =>
  getSetupPromptStore(options).path;

export const getSetupPromptProjectKey = (projectRoot: string): string =>
  createHash("sha256").update(path.resolve(projectRoot)).digest("hex");

export const hasDisabledSetupPrompt = (
  projectRoot: string,
  storeOptions: SetupPromptStoreOptions = {},
): boolean => {
  try {
    const store = getSetupPromptStore(storeOptions);
    const projects = store.get("projects", {});
    return projects[getSetupPromptProjectKey(projectRoot)]?.setupPrompt === false;
  } catch {
    // A read-only or otherwise inaccessible global-config directory (EPERM /
    // EROFS in locked-down CI and sandboxes) is an environment limitation, not
    // a react-doctor bug. Degrade to "not disabled" rather than crashing the
    // scan and reporting it to Sentry — at worst the install hint shows again.
    return false;
  }
};

export const disableSetupPrompt = (
  projectRoot: string,
  storeOptions: SetupPromptStoreOptions = {},
): boolean => {
  try {
    const store = getSetupPromptStore(storeOptions);
    const projects = store.get("projects", {});
    const projectKey = getSetupPromptProjectKey(projectRoot);
    store.set("projects", {
      ...projects,
      [projectKey]: {
        ...(projects[projectKey] ?? {}),
        rootDirectory: path.resolve(projectRoot),
        setupPrompt: false,
      },
    });
    return true;
  } catch {
    // Couldn't persist the opt-out (read-only config dir). Signal failure to
    // the caller instead of crashing — the choice just won't be remembered.
    return false;
  }
};

export const resolveInstallSetupProjectRoot = (
  options: ResolveInstallSetupProjectRootOptions,
): string | null => {
  if (options.scanDirectories.length === 0) {
    return findNearestPackageDirectory(options.scanRoot) ?? options.scanRoot;
  }

  const packageDirectories = new Set<string>();
  for (const scanDirectory of options.scanDirectories) {
    const packageDirectory =
      findNearestPackageDirectory(scanDirectory, options.scanRoot) ??
      findNearestPackageDirectory(scanDirectory) ??
      scanDirectory;
    packageDirectories.add(packageDirectory);
  }

  if (packageDirectories.size !== 1) {
    return findNearestPackageDirectory(options.scanRoot, options.scanRoot);
  }
  return [...packageDirectories][0] ?? null;
};

const defaultWriteLine: SetupPitchWriter = (line = "") => {
  console.log(line);
};

export interface ShouldShowAgentInstallHintOptions {
  readonly projectRoot: string;
  readonly hasCompletedScan?: boolean;
  readonly hasScoredScan?: boolean;
  readonly isJsonMode: boolean;
  readonly isScoreOnly: boolean;
  readonly isStaged: boolean;
  readonly isCodingAgent?: boolean;
  readonly store?: SetupPromptStoreOptions;
}

export const shouldShowAgentInstallHint = (options: ShouldShowAgentInstallHintOptions): boolean => {
  if (!(options.hasCompletedScan ?? options.hasScoredScan ?? false)) return false;
  if (options.isJsonMode) return false;
  if (options.isScoreOnly) return false;
  if (options.isStaged) return false;
  if (!(options.isCodingAgent ?? isCodingAgentEnvironment())) return false;
  if (hasDisabledSetupPrompt(options.projectRoot, options.store)) return false;
  return !hasDoctorScript(options.projectRoot);
};

export const AGENT_INSTALL_HINT_LINES = [
  "React Doctor is not installed in this project.",
  "Ask the user if they would like to set it up, then run:",
  "",
  "  npx react-doctor install --yes",
  "",
  "This adds agent skill files, a `doctor` package script, and react-doctor as a dev dependency.",
] as const;

export const printAgentInstallHint = (writeLine: SetupPitchWriter = defaultWriteLine): void => {
  writeLine("");
  for (const line of AGENT_INSTALL_HINT_LINES) {
    writeLine(line);
  }
};
