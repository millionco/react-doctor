import {
  MILLISECONDS_PER_SECOND,
  MIN_SCAN_CONCURRENCY,
  OXLINT_PARTIAL_FAILURE_PREVIEW_COUNT,
  OXLINT_SPLIT_MAX_DEPTH,
  OXLINT_SPLIT_TOTAL_BUDGET_MS,
  PROGRESS_TICK_INTERVAL_MS,
} from "../../constants.js";
import type { Diagnostic, ProjectInfo } from "../../types/index.js";
import { isSplittableReactDoctorError, ReactDoctorError } from "../../errors.js";
import { dedupeDiagnostics } from "../../utils/dedupe-diagnostics.js";
import { mapWithConcurrency } from "../../utils/map-with-concurrency.js";
import { resolveScanConcurrency } from "../../utils/resolve-scan-concurrency.js";
import { parseOxlintOutput } from "./parse-output.js";
import { spawnOxlint } from "./spawn-oxlint.js";

// OS-level `spawn` failures that mean "the system can't accommodate ANOTHER
// concurrent subprocess right now": fork ran out of process slots (EAGAIN),
// the per-process (EMFILE) or system-wide (ENFILE) fd table is full from the
// pipes each child needs, or the kernel couldn't allocate the new process
// (ENOMEM). They're exclusive to parallel runs — a serial pass spawns one
// oxlint child at a time and never trips them — so they're the one failure the
// serial replay below can clear.
const PARALLELISM_EXHAUSTION_ERROR_CODES = new Set(["EAGAIN", "EMFILE", "ENFILE", "ENOMEM"]);

// True only for an oxlint spawn failure from the resource exhaustion above.
// Every other failure (config crash, plugin-resolution error, unparseable
// output, a per-batch budget timeout) is independent of the worker count and
// would recur serially, so it must propagate rather than trigger a replay.
const isParallelismRelatedSpawnError = (error: unknown): boolean => {
  if (!(error instanceof ReactDoctorError)) return false;
  const { reason } = error;
  if (reason._tag !== "OxlintSpawnFailed") return false;
  const { cause } = reason;
  if (typeof cause !== "object" || cause === null || !("code" in cause)) return false;
  const { code } = cause;
  return typeof code === "string" && PARALLELISM_EXHAUSTION_ERROR_CODES.has(code);
};

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
  /**
   * Cumulative wall-clock budget across ALL binary-split retries of one
   * batch (defaults to `OXLINT_SPLIT_TOTAL_BUDGET_MS`). Bounds the cascade
   * where one pathological file re-waits a full `spawnTimeoutMs` at each of
   * ~log2(batch) split levels. A parameter (not a direct constant read) so
   * the bound is deterministically testable.
   */
  readonly splitTotalBudgetMs?: number;
  /** Hard cap on binary-split recursion depth (defaults to `OXLINT_SPLIT_MAX_DEPTH`). */
  readonly splitMaxDepth?: number;
  /**
   * Aborted when the orchestrator's lint-phase timeout fires; forwarded to
   * every `spawnOxlint` so the in-flight subprocess is SIGKILL'd and any
   * not-yet-spawned batch short-circuits — stopping the lint work rather than
   * leaving subprocesses running until their own spawn timeout.
   */
  readonly signal?: AbortSignal;
  /**
   * Number of batches to lint in parallel (from `OxlintConcurrency`).
   * Defaults to `1` (serial) when omitted. Each batch is its own oxlint
   * subprocess, so `N` here means up to `N` concurrent oxlint processes —
   * the lint pass scales with `N` because oxlint's JS plugins are
   * single-threaded per process. The generated oxlintrc / ignore files are
   * read-only and shared across workers, so there's no per-worker setup.
   * A parallel pass (`N > 1`) that fails with a parallelism-exclusive
   * resource error replays once with a single worker.
   */
  readonly concurrency?: number;
}

/**
 * Runs every prebuilt file batch through oxlint, with binary-split
 * retry on the splittable error classes (timeout / output-too-large /
 * OOM / killed by signal). When a single-file batch still fails with
 * a splittable error, the file is recorded into a dropped-files list
 * (surfaced via `onPartialFailure`) so JSON-mode consumers see WHICH
 * files were skipped instead of silently losing them.
 *
 * Parallel runs (concurrency > 1) get one extra safety net: if the pass
 * fails with a resource-exhaustion error that's exclusive to running
 * many oxlint subprocesses at once (EAGAIN / EMFILE / ENFILE / ENOMEM —
 * see `isParallelismRelatedSpawnError`), the whole pass replays once
 * with a single worker. That's the only failure a serial replay can
 * clear, so every other error class is left to propagate.
 *
 * Errors that aren't splittable and aren't parallelism-related (oxlint
 * config crash, JS plugin resolution failure, etc.) propagate to the
 * caller — the `runOxlint` retry-without-extends fallback re-spawns this
 * loop with a slimmer config in that case.
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
    splitTotalBudgetMs = OXLINT_SPLIT_TOTAL_BUDGET_MS,
    splitMaxDepth = OXLINT_SPLIT_MAX_DEPTH,
    signal,
  } = input;
  // Clamp at the spawn boundary so any caller — including programmatic
  // `inspect({ concurrency })` that skips the CLI's resolver — is bounded by
  // the [MIN, HARD_MAX] worker ceiling and can't oversubscribe oxlint processes.
  const requestedConcurrency = resolveScanConcurrency(input.concurrency ?? MIN_SCAN_CONCURRENCY);
  const totalFileCount = fileBatches.reduce((sum, batch) => sum + batch.length, 0);

  // One full pass over every batch at `concurrency` workers. All mutable
  // state (diagnostics, dropped-file bookkeeping, progress counters, the
  // progress timer) is scoped here so the serial fallback below can replay
  // the pass from a clean slate instead of inheriting half-populated state
  // from a parallel attempt that died mid-flight.
  const runBatchPass = async (concurrency: number): Promise<Diagnostic[]> => {
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

    // Cumulative deadline shared across every binary-split retry of this
    // pass, so one pathological file can't re-wait a full `spawnTimeoutMs`
    // at each of ~log2(batch) levels before landing in `droppedFiles`.
    const splitDeadlineMs = Date.now() + splitTotalBudgetMs;

    const spawnLintBatch = async (batch: string[], depth: number): Promise<Diagnostic[]> => {
      const batchArgs = [...baseArgs, ...batch];
      try {
        const stdout = await spawnOxlint(
          batchArgs,
          rootDirectory,
          nodeBinaryPath,
          spawnTimeoutMs,
          outputMaxBytes,
          signal,
        );
        return parseOxlintOutput(stdout, project, rootDirectory);
      } catch (error) {
        if (!isSplittableReactDoctorError(error)) throw error;
        const splitBudgetExhausted = Date.now() >= splitDeadlineMs || depth >= splitMaxDepth;
        if (batch.length <= 1 || splitBudgetExhausted) {
          // Either the smallest splittable batch (a single file) still failed,
          // or the cumulative split budget / depth cap is exhausted — drop the
          // remaining files, record why, and let the scan continue.
          droppedFiles.push(...batch);
          if (firstDropReason === null) {
            firstDropReason =
              splitBudgetExhausted && batch.length > 1
                ? `${error.message} (split budget exhausted after ${splitMaxDepth} levels / ${splitTotalBudgetMs / MILLISECONDS_PER_SECOND}s)`
                : error.message;
          }
          return [];
        }
        const splitIndex = Math.ceil(batch.length / 2);
        return [
          ...(await spawnLintBatch(batch.slice(0, splitIndex), depth + 1)),
          ...(await spawnLintBatch(batch.slice(splitIndex), depth + 1)),
        ];
      }
    };

    // One shared progress ticker (batches finish out of order under parallelism,
    // so a single monotonic counter is the honest model): it creeps the displayed
    // count toward the files handed to a worker, and each finished batch snaps it
    // to the real scanned count. Unref'd and always cleared in `finally` so a
    // rejected batch can't leak a ref'd timer and hang the CLI (issue #599).
    let startedFileCount = 0;
    let scannedFileCount = 0;
    let displayedFileCount = 0;
    const progressTimer =
      onFileProgress && totalFileCount > 1
        ? setInterval(() => {
            const ceiling = Math.min(startedFileCount, totalFileCount - 1);
            if (displayedFileCount < ceiling) {
              displayedFileCount += 1;
              onFileProgress(displayedFileCount, totalFileCount);
            }
          }, PROGRESS_TICK_INTERVAL_MS)
        : null;
    progressTimer?.unref?.();

    try {
      const batchResults = await mapWithConcurrency(fileBatches, concurrency, async (batch) => {
        startedFileCount += batch.length;
        const batchDiagnostics = await spawnLintBatch(batch, 0);
        scannedFileCount += batch.length;
        if (onFileProgress) {
          displayedFileCount = Math.min(
            Math.max(displayedFileCount, scannedFileCount),
            totalFileCount,
          );
          onFileProgress(displayedFileCount, totalFileCount);
        }
        return batchDiagnostics;
      });
      for (const batchDiagnostics of batchResults) allDiagnostics.push(...batchDiagnostics);
    } finally {
      if (progressTimer !== null) clearInterval(progressTimer);
    }

    // Report dropped files once per completed pass. A pass that throws (e.g.
    // the parallel attempt below hitting EAGAIN) exits before this point, so
    // only the winning pass surfaces its skips.
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
    return allDiagnostics;
  };

  // Parallel runs get one serial retry, but only for the parallelism-exclusive
  // resource exhaustion a single worker can clear. Any other error — or a run
  // that was already serial — would recur, so it propagates.
  let diagnostics: Diagnostic[];
  try {
    diagnostics = await runBatchPass(requestedConcurrency);
  } catch (error) {
    if (requestedConcurrency <= MIN_SCAN_CONCURRENCY || !isParallelismRelatedSpawnError(error)) {
      throw error;
    }
    diagnostics = await runBatchPass(MIN_SCAN_CONCURRENCY);
  }
  return dedupeDiagnostics(diagnostics);
};
