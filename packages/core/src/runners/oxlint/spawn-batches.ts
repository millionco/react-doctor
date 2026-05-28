import {
  OXLINT_PARTIAL_FAILURE_PREVIEW_COUNT,
  PROGRESS_TICK_INTERVAL_MS,
} from "../../constants.js";
import type { Diagnostic, ProjectInfo } from "../../types/index.js";
import { isSplittableReactDoctorError } from "../../errors.js";
import { dedupeDiagnostics } from "../../utils/dedupe-diagnostics.js";
import { mapWithConcurrency } from "../../utils/map-with-concurrency.js";
import { resolveLintConcurrency } from "../../utils/resolve-lint-concurrency.js";
import { parseOxlintOutput } from "./parse-output.js";
import { spawnOxlint } from "./spawn-oxlint.js";

export interface SpawnLintBatchesInput {
  readonly baseArgs: ReadonlyArray<string>;
  readonly fileBatches: ReadonlyArray<string[]>;
  readonly rootDirectory: string;
  readonly nodeBinaryPath: string;
  readonly project: ProjectInfo;
  readonly onPartialFailure?: (reason: string) => void;
  readonly onFileProgress?: (scannedFileCount: number, totalFileCount: number) => void;
}

/**
 * Runs every prebuilt file batch through oxlint, fanning batches
 * across a bounded worker pool (`resolveLintConcurrency`) so large
 * repos saturate the available cores instead of spending the scan
 * awaiting one subprocess at a time. Each batch keeps the binary-split
 * retry on the splittable error classes (timeout / output-too-large /
 * OOM / killed by signal). When a single-file batch still fails with a
 * splittable error, the file is recorded into a dropped-files list
 * (surfaced via `onPartialFailure`) so JSON-mode consumers see WHICH
 * files were skipped instead of silently losing them.
 *
 * Errors that aren't splittable (oxlint config crash, JS plugin
 * resolution failure, etc.) reject the pool and propagate to the
 * caller — the `runOxlint` retry-without-extends fallback re-spawns
 * this loop with a slimmer config in that case.
 */
export const spawnLintBatches = async (input: SpawnLintBatchesInput): Promise<Diagnostic[]> => {
  const {
    baseArgs,
    fileBatches,
    rootDirectory,
    nodeBinaryPath,
    project,
    onPartialFailure,
    onFileProgress,
  } = input;
  const totalFileCount = fileBatches.reduce((sum, batch) => sum + batch.length, 0);

  // HACK: tracks files whose smallest splittable batch (down to a
  // single file) still failed with a splittable error — surfaced via
  // `onPartialFailure` so JSON consumers see WHICH files were dropped
  // instead of silently losing them. Composes with the binary-split:
  // large batches that time out / OOM split in half and retry; the
  // only files that reach this set are the genuinely-pathological
  // ones (e.g. one file × one quadratic JS-plugin rule, originally
  // hit on supabase/studio's `apps/studio/pages/...` bucket).
  const droppedFiles: string[] = [];
  // HACK: keep the first splittable error message we saw so
  // `onPartialFailure` can report WHY each batch failed instead of
  // misleadingly always blaming the per-batch budget. Same root cause
  // across a project tends to repeat (e.g. native binding crash on
  // every invocation in a sandbox runtime), so surfacing one example
  // is enough to diagnose.
  let firstDropReason: string | null = null;

  const spawnLintBatch = async (batch: string[]): Promise<Diagnostic[]> => {
    const batchArgs = [...baseArgs, ...batch];
    try {
      const stdout = await spawnOxlint(batchArgs, rootDirectory, nodeBinaryPath);
      return parseOxlintOutput(stdout, project, rootDirectory);
    } catch (error) {
      if (!isSplittableReactDoctorError(error)) throw error;
      if (batch.length <= 1) {
        // Single-file batch still fails with a splittable error —
        // drop the file, record it, and let the scan continue.
        droppedFiles.push(...batch);
        if (firstDropReason === null) {
          firstDropReason = error.message;
        }
        return [];
      }
      const splitIndex = Math.ceil(batch.length / 2);
      return [
        ...(await spawnLintBatch(batch.slice(0, splitIndex))),
        ...(await spawnLintBatch(batch.slice(splitIndex))),
      ];
    }
  };

  // Progress reports off a single shared accumulator so the counter
  // stays monotonic even though batches now finish out of order across
  // the pool. A timer simulates per-file ticks up to (never past) the
  // final file so the spinner stays smooth while subprocesses are in
  // flight; each completed batch snaps the counter to the real
  // completed-file total.
  let completedFileCount = 0;
  let simulatedFileCount = 0;
  const progressTicker =
    onFileProgress && totalFileCount > 1
      ? setInterval(() => {
          if (simulatedFileCount < totalFileCount - 1) {
            simulatedFileCount += 1;
            onFileProgress(Math.max(completedFileCount, simulatedFileCount), totalFileCount);
          }
        }, PROGRESS_TICK_INTERVAL_MS)
      : null;
  progressTicker?.unref?.();

  try {
    const diagnosticsPerBatch = await mapWithConcurrency(
      fileBatches,
      resolveLintConcurrency(),
      async (batch) => {
        const batchDiagnostics = await spawnLintBatch(batch);
        completedFileCount += batch.length;
        simulatedFileCount = Math.max(simulatedFileCount, completedFileCount);
        onFileProgress?.(completedFileCount, totalFileCount);
        return batchDiagnostics;
      },
    );

    if (droppedFiles.length > 0 && onPartialFailure) {
      const previewFiles = droppedFiles.slice(0, OXLINT_PARTIAL_FAILURE_PREVIEW_COUNT).join(", ");
      const remainderHint =
        droppedFiles.length > OXLINT_PARTIAL_FAILURE_PREVIEW_COUNT
          ? `, +${droppedFiles.length - OXLINT_PARTIAL_FAILURE_PREVIEW_COUNT} more`
          : "";
      const reasonHint = firstDropReason ? ` — first failure: ${firstDropReason}` : "";
      onPartialFailure(
        `${droppedFiles.length} file(s) failed to lint and were skipped (${previewFiles}${remainderHint})${reasonHint}`,
      );
    }
    return dedupeDiagnostics(diagnosticsPerBatch.flat());
  } finally {
    if (progressTicker !== null) clearInterval(progressTicker);
  }
};
