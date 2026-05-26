import { createHash } from "node:crypto";
import path from "node:path";
import Conf from "conf";
import basePrompts from "prompts";
import { findNearestPackageDirectory, hasDoctorScript } from "./install-doctor-script.js";
import { isCiOrCodingAgentEnvironment, isCodingAgentEnvironment } from "./is-ci-environment.js";
import { SETUP_PROMPT_DELAY_MS } from "./constants.js";

export interface InstallSkillRunnerOptions {
  readonly projectRoot?: string;
  readonly onPromptCancel?: () => void;
}

export interface InstallSkillRunner {
  (options: InstallSkillRunnerOptions): Promise<void>;
}

export interface SetupPromptWait {
  (milliseconds: number): Promise<void>;
}

export const SETUP_PROMPT_CHOICE_YES = "yes";
export const SETUP_PROMPT_CHOICE_NO = "no";
export const SETUP_PROMPT_CHOICE_NEVER = "never";

export interface SetupPromptSelect {
  (message: string): Promise<string>;
}

export interface SetupPitchWriter {
  (line?: string): void;
}

export interface SetupPromptWarningWriter {
  (message: string): void | Promise<void>;
}

export interface SetupPromptStoreOptions {
  readonly cwd?: string;
}

export interface ShouldPromptInstallSetupOptions {
  readonly projectRoot: string;
  readonly hasScoredScan: boolean;
  readonly isJsonMode: boolean;
  readonly isScoreOnly: boolean;
  readonly isStaged: boolean;
  readonly skipPrompts: boolean;
  readonly store?: SetupPromptStoreOptions;
}

export interface PromptInstallSetupOptions extends ShouldPromptInstallSetupOptions {
  readonly issueCount: number;
  readonly install?: InstallSkillRunner;
  readonly select?: SetupPromptSelect;
  readonly wait?: SetupPromptWait;
  readonly warn?: SetupPromptWarningWriter;
  readonly writeLine?: SetupPitchWriter;
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
  readonly completedScanDirectories: ReadonlyArray<string>;
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
  const store = getSetupPromptStore(storeOptions);
  const projects = store.get("projects", {});
  return projects[getSetupPromptProjectKey(projectRoot)]?.setupPrompt === false;
};

export const disableSetupPrompt = (
  projectRoot: string,
  storeOptions: SetupPromptStoreOptions = {},
): boolean => {
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
};

export const shouldPromptInstallSetup = (options: ShouldPromptInstallSetupOptions): boolean => {
  if (!options.hasScoredScan) return false;
  if (options.isJsonMode) return false;
  if (options.isScoreOnly) return false;
  if (options.isStaged) return false;
  if (options.skipPrompts) return false;
  if (isCiOrCodingAgentEnvironment()) return false;
  if (hasDisabledSetupPrompt(options.projectRoot, options.store)) return false;
  return !hasDoctorScript(options.projectRoot);
};

export const resolveInstallSetupProjectRoot = (
  options: ResolveInstallSetupProjectRootOptions,
): string | null => {
  if (options.completedScanDirectories.length === 0) {
    return findNearestPackageDirectory(options.scanRoot) ?? options.scanRoot;
  }

  const packageDirectories = new Set<string>();
  for (const scanDirectory of options.completedScanDirectories) {
    const packageDirectory =
      findNearestPackageDirectory(scanDirectory, options.scanRoot) ??
      findNearestPackageDirectory(scanDirectory) ??
      scanDirectory;
    packageDirectories.add(packageDirectory);
  }

  if (packageDirectories.size !== 1) return null;
  return [...packageDirectories][0] ?? null;
};

const defaultWait: SetupPromptWait = (milliseconds) =>
  new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });

const defaultSelect: SetupPromptSelect = async (message) => {
  const { setupReactDoctorChoice } = await basePrompts<"setupReactDoctorChoice">(
    {
      type: "select",
      name: "setupReactDoctorChoice",
      message,
      choices: [
        {
          title: "Yes (recommended)",
          description: "Use agents to automatically fix issues",
          value: SETUP_PROMPT_CHOICE_YES,
        },
        {
          title: "Skip",
          description: "Not recommended. Issues may go unfixed.",
          value: SETUP_PROMPT_CHOICE_NEVER,
        },
      ],
      initial: 0,
    },
    { onCancel: () => true },
  );
  return setupReactDoctorChoice ?? SETUP_PROMPT_CHOICE_NO;
};

const defaultWriteLine: SetupPitchWriter = (line = "") => {
  console.log(line);
};

const formatSetupPromptFailure = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const warnSetupPromptFailure = async (
  options: PromptInstallSetupOptions,
  error: unknown,
): Promise<void> => {
  const message = `React Doctor setup prompt skipped: ${formatSetupPromptFailure(error)}`;
  if (options.warn) {
    await options.warn(message);
    return;
  }
  try {
    const { cliLogger } = await import("./cli-logger.js");
    cliLogger.warn(message);
  } catch {}
};

export const promptInstallSetup = async (options: PromptInstallSetupOptions): Promise<void> => {
  try {
    if (!shouldPromptInstallSetup(options)) return;

    await (options.wait ?? defaultWait)(SETUP_PROMPT_DELAY_MS);

    const setupReactDoctorChoice = await (options.select ?? defaultSelect)(
      "Set up React Doctor for this project?",
    );
    if (setupReactDoctorChoice !== SETUP_PROMPT_CHOICE_YES) {
      if (setupReactDoctorChoice === SETUP_PROMPT_CHOICE_NEVER) {
        disableSetupPrompt(options.projectRoot, options.store);
      }
      const writeLine = options.writeLine ?? defaultWriteLine;
      writeLine("");
      writeLine("You can always run `npx react-doctor@latest install` to set it up later.");
      return;
    }

    const install = options.install ?? (await import("./install-skill.js")).runInstallSkill;
    const previousExitCode = process.exitCode;
    let setupExitCode: typeof process.exitCode;
    try {
      process.exitCode = undefined;
      await install({
        projectRoot: options.projectRoot,
        onPromptCancel: () => {},
      });
      setupExitCode = process.exitCode;
    } finally {
      process.exitCode = previousExitCode;
    }
    if (setupExitCode === undefined || setupExitCode === 0) {
      disableSetupPrompt(options.projectRoot, options.store);
    }
  } catch (error) {
    await warnSetupPromptFailure(options, error);
  }
};

export interface ShouldShowAgentInstallHintOptions {
  readonly projectRoot: string;
  readonly hasScoredScan: boolean;
  readonly isJsonMode: boolean;
  readonly isScoreOnly: boolean;
  readonly isStaged: boolean;
  readonly isCodingAgent?: boolean;
  readonly store?: SetupPromptStoreOptions;
}

export const shouldShowAgentInstallHint = (options: ShouldShowAgentInstallHintOptions): boolean => {
  if (!options.hasScoredScan) return false;
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
