import type { Diagnostic, ProjectInfo } from "../../types/index.js";
import { OXLINT_MAX_CONCURRENT_BATCHES_COUNT } from "../../constants.js";
import { isSplittableReactDoctorError } from "../../errors.js";
import { dedupeDiagnostics } from "../../utils/dedupe-diagnostics.js";
import { parseOxlintOutput } from "./parse-output.js";
import { spawnOxlint } from "./spawn-oxlint.js";

export interface SpawnLintBatchesInput {
  readonly baseArgs: ReadonlyArray<string>;
  readonly fileBatches: ReadonlyArray<string[]>;
  readonly rootDirectory: string;
  readonly nodeBinaryPath: string;
  readonly project: ProjectInfo;
  readonly onPartialFailure?: (reason: string) => void;
  readonly spawnOxlintProcess?: typeof spawnOxlint;
}

const PREVIEW_COUNT = 3;

interface BatchResult {
  readonly diagnostics: ReadonlyArray<Diagnostic>;
  readonly droppedFiles: ReadonlyArray<string>;
  readonly firstDropReason: string | null;
}

const EMPTY_BATCH_RESULT: BatchResult = {
  diagnostics: [],
  droppedFiles: [],
  firstDropReason: null,
};

const mergeBatchResults = (results: ReadonlyArray<BatchResult>): BatchResult => ({
  diagnostics: results.flatMap((result) => result.diagnostics),
  droppedFiles: results.flatMap((result) => result.droppedFiles),
  firstDropReason:
    results.find((result) => result.firstDropReason !== null)?.firstDropReason ?? null,
});

/**
 * Runs every prebuilt file batch through oxlint, with binary-split
 * retry on the splittable error classes (timeout / output-too-large /
 * OOM / killed by signal). When a single-file batch still fails with
 * a splittable error, the file is recorded into a dropped-files list
 * (surfaced via `onPartialFailure`) so JSON-mode consumers see WHICH
 * files were skipped instead of silently losing them.
 *
 * Errors that aren't splittable (oxlint config crash, JS plugin
 * resolution failure, etc.) propagate to the caller — the
 * `runOxlint` retry-without-extends fallback re-spawns this loop
 * with a slimmer config in that case.
 */
export const spawnLintBatches = async (input: SpawnLintBatchesInput): Promise<Diagnostic[]> => {
  const {
    baseArgs,
    fileBatches,
    rootDirectory,
    nodeBinaryPath,
    project,
    onPartialFailure,
    spawnOxlintProcess = spawnOxlint,
  } = input;

  const spawnLintBatch = async (batch: string[]): Promise<BatchResult> => {
    const batchArgs = [...baseArgs, ...batch];
    try {
      const stdout = await spawnOxlintProcess(batchArgs, rootDirectory, nodeBinaryPath);
      return {
        diagnostics: parseOxlintOutput(stdout, project, rootDirectory),
        droppedFiles: [],
        firstDropReason: null,
      };
    } catch (error) {
      if (!isSplittableReactDoctorError(error)) throw error;
      if (batch.length <= 1) {
        // Single-file batch still fails with a splittable error —
        // drop the file, record it, and let the scan continue.
        return {
          diagnostics: [],
          droppedFiles: batch,
          firstDropReason: error.message,
        };
      }
      const splitIndex = Math.ceil(batch.length / 2);
      return mergeBatchResults([
        await spawnLintBatch(batch.slice(0, splitIndex)),
        await spawnLintBatch(batch.slice(splitIndex)),
      ]);
    }
  };

  const batchResults: BatchResult[] = Array.from({ length: fileBatches.length }, () => ({
    ...EMPTY_BATCH_RESULT,
  }));
  let nextBatchIndex = 0;
  const workerCount = Math.min(OXLINT_MAX_CONCURRENT_BATCHES_COUNT, fileBatches.length);
  const runWorker = async (): Promise<void> => {
    while (nextBatchIndex < fileBatches.length) {
      const batchIndex = nextBatchIndex;
      nextBatchIndex += 1;
      batchResults[batchIndex] = await spawnLintBatch(fileBatches[batchIndex]);
    }
  };

  await Promise.all(Array.from({ length: workerCount }, () => runWorker()));
  const mergedResult = mergeBatchResults(batchResults);

  if (mergedResult.droppedFiles.length > 0 && onPartialFailure) {
    const previewFiles = mergedResult.droppedFiles.slice(0, PREVIEW_COUNT).join(", ");
    const remainderHint =
      mergedResult.droppedFiles.length > PREVIEW_COUNT
        ? `, +${mergedResult.droppedFiles.length - PREVIEW_COUNT} more`
        : "";
    const reasonHint = mergedResult.firstDropReason
      ? ` — first failure: ${mergedResult.firstDropReason}`
      : "";
    onPartialFailure(
      `${mergedResult.droppedFiles.length} file(s) failed to lint and were skipped (${previewFiles}${remainderHint})${reasonHint}`,
    );
  }
  return dedupeDiagnostics([...mergedResult.diagnostics]);
};
