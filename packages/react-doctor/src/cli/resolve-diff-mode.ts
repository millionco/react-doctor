import { logger } from "../core/logger.js";
import { filterSourceFiles } from "../core/get-diff-files.js";
import type { DiffInfo } from "../types/inspect.js";
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
      logger.warn("No feature branch or uncommitted changes detected. Running full scan.");
      logger.break();
    }
    return false;
  }

  if (effectiveDiff === false || !diffInfo) return false;

  const changedSourceFiles = filterSourceFiles(diffInfo.changedFiles);
  if (changedSourceFiles.length === 0) return false;
  if (shouldSkipPrompts) return false;
  if (isQuiet) return false;

  const promptMessage = diffInfo.isCurrentChanges
    ? `Found ${changedSourceFiles.length} uncommitted changed files. Only scan those?`
    : `On branch ${diffInfo.currentBranch} (${changedSourceFiles.length} files changed vs ${diffInfo.baseBranch}). Only scan changed files?`;

  const { shouldScanChangedOnly } = await prompts({
    type: "confirm",
    name: "shouldScanChangedOnly",
    message: promptMessage,
    initial: true,
  });
  return Boolean(shouldScanChangedOnly);
};
