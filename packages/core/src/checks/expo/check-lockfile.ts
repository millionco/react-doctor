import * as path from "node:path";
import { findMonorepoRoot, isFile, isMonorepoRoot } from "../../project-info/index.js";
import type { Diagnostic } from "../../types/index.js";
import type { ExpoCheckContext } from "./expo-check-context.js";
import { buildExpoDiagnostic } from "./utils/build-expo-diagnostic.js";

// Ported from expo-doctor's `LockfileCheck`. EAS Build infers the package
// manager from the lock file at the workspace root, so a missing lock
// file (non-reproducible installs) or multiple lock files (ambiguous
// package manager) both cause trouble.
const LOCKFILE_NAMES: ReadonlyArray<string> = [
  "pnpm-lock.yaml",
  "yarn.lock",
  "package-lock.json",
  "bun.lockb",
  "bun.lock",
];

export const checkExpoLockfile = (context: ExpoCheckContext): Diagnostic[] => {
  // `findMonorepoRoot` only walks *parent* directories, so when the scanned
  // project is itself the workspace root (its own `pnpm-workspace.yaml` /
  // `workspaces`), prefer it — otherwise we'd climb past it to an outer repo
  // and check the wrong (or a missing) lock file.
  const workspaceRoot = isMonorepoRoot(context.rootDirectory)
    ? context.rootDirectory
    : (findMonorepoRoot(context.rootDirectory) ?? context.rootDirectory);
  const presentLockfiles = LOCKFILE_NAMES.filter((lockfileName) =>
    isFile(path.join(workspaceRoot, lockfileName)),
  );

  if (presentLockfiles.length === 0) {
    return [
      buildExpoDiagnostic({
        rule: "expo-lockfile",
        message:
          "No lock file detected at the project root — installs are not reproducible, and EAS Build cannot infer your package manager",
        help: "Install dependencies with your package manager to generate a lock file, then commit it",
      }),
    ];
  }

  if (presentLockfiles.length > 1) {
    return [
      buildExpoDiagnostic({
        rule: "expo-lockfile",
        message: `Multiple lock files detected (${presentLockfiles.join(", ")}) — CI environments such as EAS Build infer the package manager from the lock file, so this is ambiguous`,
        help: "Delete the lock files for the package managers you are not using and keep only one",
      }),
    ];
  }

  return [];
};
