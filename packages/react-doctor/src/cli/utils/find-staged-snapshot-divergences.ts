import { runGitRaw } from "./git-hook-shared.js";
import { parseStagedSnapshotDivergences } from "./parse-staged-snapshot-divergences.js";

export const findStagedSnapshotDivergences = (directory: string): ReadonlyArray<string> | null => {
  const statusOutput = runGitRaw(directory, [
    "status",
    "--porcelain=v1",
    "-z",
    "--untracked-files=all",
    "--ignored=matching",
  ]);
  if (statusOutput === null) return null;
  return parseStagedSnapshotDivergences(statusOutput);
};
