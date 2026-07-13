import * as path from "node:path";
import { STAGED_FILES_PROJECT_CONFIG_FILENAMES } from "@react-doctor/core";
import { STAGED_SNAPSHOT_ADDITIONAL_CONFIG_FILENAMES } from "./constants.js";

const SNAPSHOT_CONFIG_FILENAMES = new Set<string>([
  ...STAGED_FILES_PROJECT_CONFIG_FILENAMES,
  ...STAGED_SNAPSHOT_ADDITIONAL_CONFIG_FILENAMES,
]);

export const parseStagedSnapshotDivergences = (statusOutput: string): ReadonlyArray<string> => {
  const divergentConfigFiles = new Set<string>();
  const statusEntries = statusOutput.split("\0").filter((entry) => entry.length > 0);
  for (let entryIndex = 0; entryIndex < statusEntries.length; entryIndex += 1) {
    const entry = statusEntries[entryIndex];
    const [indexStatus, worktreeStatus] = entry;
    const filePath = entry.slice("XY ".length);
    const hasRenameOrCopySource =
      indexStatus === "R" ||
      indexStatus === "C" ||
      worktreeStatus === "R" ||
      worktreeStatus === "C";
    const sourcePath = hasRenameOrCopySource ? statusEntries[entryIndex + 1] : undefined;
    const worktreePaths =
      worktreeStatus === "R" || worktreeStatus === "C" ? [filePath, sourcePath] : [filePath];
    if (worktreeStatus !== " ") {
      for (const worktreePath of worktreePaths) {
        if (worktreePath && SNAPSHOT_CONFIG_FILENAMES.has(path.basename(worktreePath))) {
          divergentConfigFiles.add(worktreePath);
        }
      }
    }
    if (hasRenameOrCopySource) entryIndex += 1;
  }
  return [...divergentConfigFiles].sort();
};
