import * as path from "node:path";
import {
  CONFIG_FINGERPRINT_FILENAMES,
  STAGED_FILES_PROJECT_CONFIG_FILENAMES,
} from "@react-doctor/core";
import { STAGED_SNAPSHOT_ADDITIONAL_CONFIG_FILENAMES } from "./constants.js";
import { runGitRaw } from "./git-hook-shared.js";

const SNAPSHOT_CONFIG_FILENAMES = new Set<string>([
  ...CONFIG_FINGERPRINT_FILENAMES,
  ...STAGED_FILES_PROJECT_CONFIG_FILENAMES,
  ...STAGED_SNAPSHOT_ADDITIONAL_CONFIG_FILENAMES,
]);

export const findStagedSnapshotDivergences = (directory: string): ReadonlyArray<string> | null => {
  const statusOutput = runGitRaw(directory, [
    "status",
    "--porcelain=v1",
    "-z",
    "--untracked-files=all",
    "--ignored=matching",
  ]);
  if (statusOutput === null) return null;
  const divergentConfigFiles = new Set<string>();
  const statusEntries = statusOutput.split("\0").filter((entry) => entry.length > 0);
  for (let entryIndex = 0; entryIndex < statusEntries.length; entryIndex += 1) {
    const entry = statusEntries[entryIndex];
    const [indexStatus, worktreeStatus] = entry;
    const filePath = entry.slice("XY ".length);
    if (worktreeStatus !== " " && SNAPSHOT_CONFIG_FILENAMES.has(path.basename(filePath))) {
      divergentConfigFiles.add(filePath);
    }
    if (indexStatus === "R" || indexStatus === "C") entryIndex += 1;
  }
  return [...divergentConfigFiles].sort();
};
