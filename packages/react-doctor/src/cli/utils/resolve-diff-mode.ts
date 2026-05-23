import { filterSourceFiles } from "@react-doctor/core";
import type { DiffInfo } from "@react-doctor/core";
import { cliLogger as logger } from "./cli-logger.js";
import { prompts } from "./prompts.js";

export const resolveDiffMode = async (
  diffInfo: DiffInfo | null,
  effectiveDiff: boolean | string | undefined,
  shouldSkipPrompts: boolean,
  isQuiet: boolean,
): Promise<boolean> => {
  if (effectiveDiff !== undefined && effectiveDiff !== false) {
    if (diffInfo) return true;
    if (!isQuiet) {
      // Differentiate the two failure modes so silent CI scope-drops
      // surface immediately. When `--diff <base>` was passed
      // explicitly, the user expects a scoped scan — saying "no
      // feature branch detected" is misleading because they told us
      // exactly what to diff against.
      if (typeof effectiveDiff === "string") {
        logger.warn(
          `Could not compute diff against "${effectiveDiff}" (merge-base failed or HEAD has no history). Running full scan.`,
        );
      } else {
        logger.warn("No feature branch or uncommitted changes detected. Running full scan.");
      }
      logger.break();
    }
    return false;
  }

  if (effectiveDiff === false || !diffInfo) return false;

  const changedSourceFiles = filterSourceFiles(diffInfo.changedFiles);
  if (changedSourceFiles.length === 0) return false;
  if (shouldSkipPrompts) return false;
  if (isQuiet) return false;

  const currentBranchLabel = diffInfo.currentBranch ?? "(detached HEAD)";
  const promptMessage = diffInfo.isCurrentChanges
    ? `Found ${changedSourceFiles.length} uncommitted changed files. Only scan those?`
    : `On branch ${currentBranchLabel} (${changedSourceFiles.length} files changed vs ${diffInfo.baseBranch}). Only scan changed files?`;

  const { shouldScanChangedOnly } = await prompts({
    type: "confirm",
    name: "shouldScanChangedOnly",
    message: promptMessage,
    initial: true,
  });
  return Boolean(shouldScanChangedOnly);
};
