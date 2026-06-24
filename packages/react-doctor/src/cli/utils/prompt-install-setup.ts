import { type CliStateOptions, SETUP_HINT_EVENT, getCliStatePath } from "./cli-state-store.js";
import { type Gate, isGatePending, recordGate } from "./cli-lifecycle.js";
import { hashProjectRoot } from "./hash-project-root.js";
import { findNearestPackageDirectory, hasDoctorScript } from "./install-doctor-script.js";
import { isCodingAgentEnvironment } from "./is-ci-environment.js";

export interface SetupPitchWriter {
  (line?: string): void;
}

export interface ResolveInstallSetupProjectRootOptions {
  readonly scanRoot: string;
  readonly scanDirectories: ReadonlyArray<string>;
}

// The agent install hint is a persistent per-repo nudge shown until dismissed,
// so it's a gate with `fireWhenUnknown: true`: an unreadable store fails safe to
// "show again" (better than crashing a scan), matching the prior behavior.
const SETUP_HINT_GATE: Gate = { id: SETUP_HINT_EVENT, scope: "project", fireWhenUnknown: true };

export const getSetupPromptConfigPath = getCliStatePath;

export const getSetupPromptProjectKey = (projectRoot: string): string =>
  hashProjectRoot(projectRoot);

export const hasDisabledSetupPrompt = (
  projectRoot: string,
  options: CliStateOptions = {},
): boolean => !isGatePending(SETUP_HINT_GATE, { projectRoot }, options);

export const disableSetupPrompt = (projectRoot: string, options: CliStateOptions = {}): boolean =>
  recordGate(SETUP_HINT_GATE, { projectRoot, outcome: "declined" }, options);

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
  readonly store?: CliStateOptions;
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
