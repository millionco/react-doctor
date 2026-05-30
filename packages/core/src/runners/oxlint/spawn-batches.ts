import {
  OXLINT_PARTIAL_FAILURE_PREVIEW_COUNT,
  PROGRESS_TICK_INTERVAL_MS,
} from "../../constants.js";
import type { Diagnostic, ProjectInfo } from "../../types/index.js";
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
  readonly onFileProgress?: (scannedFileCount: number, totalFileCount: number) => void;
  /** Per-batch wall-clock budget (from `OxlintSpawnTimeoutMs`). */
  readonly spawnTimeoutMs?: number;
  /** Per-batch stdout+stderr byte cap (from `OxlintOutputMaxBytes`). */
  readonly outputMaxBytes?: number;
}

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
    onFileProgress,
    spawnTimeoutMs,
    outputMaxBytes,
  } = input;
  const totalFileCount = fileBatches.reduce((sum, batch) => sum + batch.length, 0);

  const allDiagnostics: Diagnostic[] = [];
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
      const stdout = await spawnOxlint(
        batchArgs,
        rootDirectory,
        nodeBinaryPath,
        spawnTimeoutMs,
        outputMaxBytes,
      );
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

  let scannedFileCount = 0;
  for (const batch of fileBatches) {
    // HACK: tick the progress counter per-file on a timer while the
    // batch subprocess runs, so the UI feels smooth instead of jumping
    // by 100 when each batch completes. The interval is cleared as
    // soon as the batch settles — any remaining files in the batch
    // are counted in one final update.
    let batchFileIndex = 0;
    const progressInterval =
      onFileProgress && batch.length > 1
        ? setInterval(() => {
            if (batchFileIndex < batch.length) {
              batchFileIndex += 1;
              onFileProgress(scannedFileCount + batchFileIndex, totalFileCount);
            }
          }, PROGRESS_TICK_INTERVAL_MS)
        : null;
    // Clear in `finally` so a rejected batch (e.g. an adopted lint config
    // crashing oxlint) can't leak this ref'd timer — a leak keeps the event
    // loop alive and hangs the CLI after output prints (issue #599).
    try {
      const batchDiagnostics = await spawnLintBatch(batch);
      allDiagnostics.push(...batchDiagnostics);
      scannedFileCount += batch.length;
      onFileProgress?.(scannedFileCount, totalFileCount);
    } finally {
      if (progressInterval !== null) clearInterval(progressInterval);
    }
  }

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
  return dedupeDiagnostics(allDiagnostics);
};
