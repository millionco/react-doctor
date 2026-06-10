import * as path from "node:path";
import { getPackageJsonPath, isRecord, readPackageJson, writeJsonFile } from "./git-hook-shared.js";
import { spinner } from "./spinner.js";
import * as fs from "node:fs";

const DOCTOR_SCRIPT_NAME = "doctor";
const FALLBACK_DOCTOR_SCRIPT_NAME = "react-doctor";
const DOCTOR_SCRIPT_COMMAND = "npx react-doctor@latest";
export const DOCTOR_PACKAGE_NAME = "react-doctor";

const DEPENDENCY_FIELD_NAMES: readonly string[] = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
];

export interface InstallDoctorScriptOptions {
  readonly projectRoot: string;
}

export interface InstallDoctorScriptResult {
  readonly packageJsonPath: string;
  readonly scriptName?: string;
  readonly scriptStatus: "created" | "existing" | "skipped";
  readonly scriptReason?:
    | "missing-or-invalid-package-json"
    | "invalid-scripts"
    | "doctor-script-taken"
    | "script-names-taken";
}

const isReactDoctorScriptCommand = (value: unknown): boolean =>
  typeof value === "string" && /\breact-doctor\b/.test(value);

export const findNearestPackageDirectory = (
  startDirectory: string,
  stopDirectory?: string,
): string | null => {
  let currentDirectory = path.resolve(startDirectory);
  const resolvedStopDirectory =
    stopDirectory === undefined ? undefined : path.resolve(stopDirectory);

  while (true) {
    if (fs.existsSync(getPackageJsonPath(currentDirectory))) return currentDirectory;
    if (currentDirectory === resolvedStopDirectory) return null;
    const parentDirectory = path.dirname(currentDirectory);
    if (parentDirectory === currentDirectory) return null;
    currentDirectory = parentDirectory;
  }
};

export const hasDoctorScript = (projectRoot: string): boolean => {
  const packageDirectory = findNearestPackageDirectory(projectRoot) ?? projectRoot;
  const packageJson = readPackageJson(packageDirectory);
  if (!isRecord(packageJson)) return false;
  const scripts = packageJson.scripts;
  if (!isRecord(scripts)) return false;
  return (
    isReactDoctorScriptCommand(scripts[DOCTOR_SCRIPT_NAME]) ||
    isReactDoctorScriptCommand(scripts[FALLBACK_DOCTOR_SCRIPT_NAME])
  );
};

export const hasDoctorDependency = (packageJson: Record<string, unknown>): boolean =>
  DEPENDENCY_FIELD_NAMES.some((fieldName) => {
    const dependencies = packageJson[fieldName];
    return isRecord(dependencies) && Object.hasOwn(dependencies, DOCTOR_PACKAGE_NAME);
  });

export const installDoctorScript = (
  options: InstallDoctorScriptOptions,
): InstallDoctorScriptResult => {
  const packageDirectory = findNearestPackageDirectory(options.projectRoot) ?? options.projectRoot;
  const packageJsonPath = getPackageJsonPath(packageDirectory);
  const packageJson = readPackageJson(packageDirectory);

  if (!isRecord(packageJson)) {
    return {
      packageJsonPath,
      scriptStatus: "skipped",
      scriptReason: "missing-or-invalid-package-json",
    };
  }

  const scripts = packageJson.scripts;
  const scriptTarget = (() => {
    if (scripts !== undefined && !isRecord(scripts)) {
      return {
        status: "skipped" as const,
        reason: "invalid-scripts" as const,
      };
    }

    const scriptRecord = isRecord(scripts) ? scripts : {};
    if (isReactDoctorScriptCommand(scriptRecord[DOCTOR_SCRIPT_NAME])) {
      return {
        scriptName: DOCTOR_SCRIPT_NAME,
        status: "existing" as const,
      };
    }
    if (!Object.hasOwn(scriptRecord, DOCTOR_SCRIPT_NAME)) {
      if (isReactDoctorScriptCommand(scriptRecord[FALLBACK_DOCTOR_SCRIPT_NAME])) {
        return {
          scriptName: FALLBACK_DOCTOR_SCRIPT_NAME,
          status: "existing" as const,
        };
      }
      return {
        scriptName: DOCTOR_SCRIPT_NAME,
        status: "created" as const,
      };
    }
    if (isReactDoctorScriptCommand(scriptRecord[FALLBACK_DOCTOR_SCRIPT_NAME])) {
      return {
        scriptName: FALLBACK_DOCTOR_SCRIPT_NAME,
        status: "existing" as const,
        reason: "doctor-script-taken" as const,
      };
    }
    if (Object.hasOwn(scriptRecord, FALLBACK_DOCTOR_SCRIPT_NAME)) {
      return {
        status: "skipped" as const,
        reason: "script-names-taken" as const,
      };
    }
    return {
      scriptName: FALLBACK_DOCTOR_SCRIPT_NAME,
      status: "created" as const,
      reason: "doctor-script-taken" as const,
    };
  })();
  const scriptStatus = scriptTarget.status;
  const didCreateScript = scriptStatus === "created";

  if (didCreateScript) {
    writeJsonFile(packageJsonPath, {
      ...packageJson,
      scripts: {
        ...(isRecord(scripts) ? scripts : {}),
        [scriptTarget.scriptName ?? DOCTOR_SCRIPT_NAME]: DOCTOR_SCRIPT_COMMAND,
      },
    });
  }

  return {
    packageJsonPath,
    ...(scriptTarget.scriptName !== undefined ? { scriptName: scriptTarget.scriptName } : {}),
    scriptStatus,
    ...(scriptTarget.reason !== undefined ? { scriptReason: scriptTarget.reason } : {}),
  };
};

const formatDoctorScriptInstallMessage = (scriptResult: InstallDoctorScriptResult): string => {
  const scriptName = scriptResult.scriptName ?? "doctor";
  if (scriptResult.scriptStatus === "created") {
    return `Added package script: ${scriptName}.`;
  }
  if (scriptResult.scriptStatus === "existing") {
    return `Package script already exists: ${scriptName}.`;
  }
  if (scriptResult.scriptReason === "script-names-taken") {
    return "Skipped package script: doctor and react-doctor are already taken.";
  }
  if (scriptResult.scriptReason === "doctor-script-taken") {
    return "Skipped package script: doctor and react-doctor scripts already exist.";
  }
  if (scriptResult.scriptReason === "invalid-scripts") {
    return "Skipped package script: scripts field is not an object.";
  }
  return "Skipped package script: package.json missing or invalid.";
};

// Adds the `doctor` (or `react-doctor`) script to package.json so users can
// run `pnpm doctor` / `npm run doctor`. The script invokes `npx react-doctor@latest`,
// so no local dev-dep is required for it to work — that's why the "Add to CI"
// path calls this step directly instead of the full package-setup function.
export const installReactDoctorScriptStep = (projectRoot: string): void => {
  const scriptSpinner = spinner("Installing React Doctor package script...").start();
  try {
    const scriptResult = installDoctorScript({ projectRoot });
    scriptSpinner.succeed(formatDoctorScriptInstallMessage(scriptResult));
  } catch (error) {
    scriptSpinner.fail("Failed to install React Doctor package script.");
    throw error;
  }
};
