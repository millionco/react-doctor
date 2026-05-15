import { OXLINT_MAX_FILES_PER_BATCH, SPAWN_ARGS_MAX_LENGTH_CHARS } from "../constants.js";

const estimateArgsLength = (args: string[]): number =>
  args.reduce((total, argument) => total + argument.length + 1, 0);

// Splits a (possibly huge) include-path list into batches that each
// fit under BOTH the spawn-args byte budget (Windows CreateProcessW caps
// at 32_767 chars; we use SPAWN_ARGS_MAX_LENGTH_CHARS as conservative
// headroom) AND the per-batch file-count budget (oxlint's native binding
// can SIGABRT under memory pressure on very large file sets — see #84).
export const batchIncludePaths = (baseArgs: string[], includePaths: string[]): string[][] => {
  const baseArgsLength = estimateArgsLength(baseArgs);
  const batches: string[][] = [];
  let currentBatch: string[] = [];
  let currentBatchLength = baseArgsLength;

  for (const filePath of includePaths) {
    const entryLength = filePath.length + 1;
    const exceedsArgLength =
      currentBatch.length > 0 && currentBatchLength + entryLength > SPAWN_ARGS_MAX_LENGTH_CHARS;
    const exceedsFileCount = currentBatch.length >= OXLINT_MAX_FILES_PER_BATCH;

    if (exceedsArgLength || exceedsFileCount) {
      batches.push(currentBatch);
      currentBatch = [];
      currentBatchLength = baseArgsLength;
    }
    currentBatch.push(filePath);
    currentBatchLength += entryLength;
  }

  if (currentBatch.length > 0) {
    batches.push(currentBatch);
  }

  return batches;
};
