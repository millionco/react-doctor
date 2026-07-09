import {
  MILLISECONDS_PER_SECOND,
  MIN_SCAN_CONCURRENCY,
  OXLINT_OOM_RESCUE_BUDGET_MS,
  OXLINT_PARTIAL_FAILURE_PREVIEW_COUNT,
  OXLINT_SPLIT_MAX_DEPTH,
  OXLINT_SPLIT_TOTAL_BUDGET_MS,
  PROGRESS_TICK_INTERVAL_MS,
} from "../../constants.js";
import type { Diagnostic, ProjectInfo } from "../../types/index.js";
import { isSplittableReactDoctorError, ReactDoctorError } from "../../errors.js";
import { dedupeDiagnostics } from "../../utils/dedupe-diagnostics.js";
import { mapWithConcurrency } from "../../utils/map-with-concurrency.js";
import { remainingDeadlineBudgetMs } from "../../utils/remaining-deadline-budget-ms.js";
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
   * Absolute epoch-millisecond deadline for the whole lint pass (from the
   * caller's `--max-duration` budget). Once it passes, batches that haven't
   * started yet are skipped — recorded and surfaced via `onPartialFailure` —
   * instead of spawned, so the scan degrades to partial results rather than
   * running past the budget. In-flight batches finish normally, but their
   * binary-split retries re-check the deadline before re-spawning.
   */
  readonly deadlineEpochMs?: number;
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

interface BatchPassOutcome {
  readonly diagnostics: Diagnostic[];
  readonly droppedFiles: string[];
  /** Subset of `droppedFiles` whose failing error was the OOM kind. */
  readonly oomDroppedFiles: string[];
  readonly deadlineSkippedFiles: string[];
  readonly firstDropReason: string | null;
  /**
   * First drop reason among NON-OOM drops. After a rescue clears the OOM
   * drops, the surviving dropped files were dropped for other reasons
   * (timeouts, output caps) — attributing them to the rescued OOM would
   * point users at a failure class that no longer applies.
   */
  readonly firstNonOomDropReason: string | null;
}

/**
 * Runs every prebuilt file batch through oxlint, with binary-split
 * retry on the splittable error classes (timeout / output-too-large /
 * OOM / killed by signal). When a single-file batch still fails with
 * a splittable error, the file is recorded into a dropped-files list
 * (surfaced via `onPartialFailure`) so JSON-mode consumers see WHICH
 * files were skipped instead of silently losing them.
 *
 * Parallel runs (concurrency > 1) get two extra safety nets:
 * - If the pass fails with a resource-exhaustion error that's exclusive
 *   to running many oxlint subprocesses at once (EAGAIN / EMFILE /
 *   ENFILE / ENOMEM — see `isParallelismRelatedSpawnError`), the whole
 *   pass replays once with a single worker. That's the only failure a
 *   serial replay can clear, so every other error class is left to
 *   propagate.
 * - Files dropped because oxlint's native binding SIGABRT'd under
 *   memory pressure (`OxlintBatchExceeded { kind: "oom" }`) get one
 *   serial single-file-batch rescue pass: the OOM is usually a function
 *   of N concurrent oxlint allocator arenas, not the file itself, so a
 *   lone process with the machine to itself typically clears it —
 *   turning a partial scan into a complete (if slower) one.
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
    deadlineEpochMs,
  } = input;
  // Clamp at the spawn boundary so any caller — including programmatic
  // `inspect({ concurrency })` that skips the CLI's resolver — is bounded by
  // the [MIN, HARD_MAX] worker ceiling and can't oversubscribe oxlint processes.
  const requestedConcurrency = resolveScanConcurrency(input.concurrency ?? MIN_SCAN_CONCURRENCY);
  // The OOM rescue pass installs its own (shorter) deadline here so a serial
  // replay of many still-failing files can't eat the whole lint-phase budget.
  let rescueDeadlineEpochMs: number | undefined;
  const isPastDeadline = (): boolean =>
    (deadlineEpochMs !== undefined && remainingDeadlineBudgetMs(deadlineEpochMs) === 0) ||
    (rescueDeadlineEpochMs !== undefined && remainingDeadlineBudgetMs(rescueDeadlineEpochMs) === 0);

  // One full pass over the given batches at `concurrency` workers. All
  // mutable state (diagnostics, dropped-file bookkeeping, progress counters,
  // the progress timer) is scoped here so the serial fallback and the OOM
  // rescue below replay from a clean slate instead of inheriting
  // half-populated state from an attempt that died mid-flight.
  const runBatchPass = async (
    concurrency: number,
    passBatches: ReadonlyArray<string[]>,
    passOnFileProgress: SpawnLintBatchesInput["onFileProgress"],
  ): Promise<BatchPassOutcome> => {
    const totalFileCount = passBatches.reduce((sum, batch) => sum + batch.length, 0);
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
    const oomDroppedFiles: string[] = [];
    // Batches that never spawned because `deadlineEpochMs` passed — reported
    // apart from `droppedFiles` (budget exhaustion, not pathological files).
    const deadlineSkippedFiles: string[] = [];
    // HACK: keep the first splittable error message we saw so
    // `onPartialFailure` can report WHY each batch failed instead of
    // misleadingly always blaming the per-batch budget. Same root cause
    // across a project tends to repeat (e.g. native binding crash on
    // every invocation in a sandbox runtime), so surfacing one example
    // is enough to diagnose.
    let firstDropReason: string | null = null;
    let firstNonOomDropReason: string | null = null;

    // Per-top-level-batch state threaded through the binary-split recursion
    // (which awaits its two halves sequentially, so this is race-free even
    // under concurrent top-level batches). `deadlineMs` is the split budget,
    // anchored lazily at the batch's FIRST splittable failure — anchoring at
    // pass start would let healthy lint time consume it — and scoped per batch
    // so one bad batch can't starve a later one. `deadlineSkippedFileCount`
    // tallies files THIS batch skipped for `--max-duration`, counted here
    // rather than off the shared `deadlineSkippedFiles` (which concurrent
    // workers append to, so a length-diff would count another worker's skips).
    const spawnLintBatch = async (
      batch: string[],
      depth: number,
      batchState: { deadlineMs: number | null; deadlineSkippedFileCount: number },
    ): Promise<Diagnostic[]> => {
      // Past the --max-duration budget: skip instead of spawning, even inside a
      // binary-split retry, so a batch that started just before the deadline
      // can't keep splitting past it.
      if (isPastDeadline()) {
        deadlineSkippedFiles.push(...batch);
        batchState.deadlineSkippedFileCount += batch.length;
        return [];
      }
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
        // A splittable failure that surfaced only after the deadline passed is
        // a budget skip, not a pathological drop — attribute it accordingly.
        if (isPastDeadline()) {
          deadlineSkippedFiles.push(...batch);
          batchState.deadlineSkippedFileCount += batch.length;
          return [];
        }
        batchState.deadlineMs ??= Date.now() + splitTotalBudgetMs;
        const isBudgetElapsed = Date.now() >= batchState.deadlineMs;
        const isDepthCapReached = depth >= splitMaxDepth;
        if (batch.length <= 1 || isBudgetElapsed || isDepthCapReached) {
          // Either the smallest splittable batch (a single file) still failed,
          // or the cumulative split budget / depth cap is exhausted — drop the
          // remaining files, record why, and let the scan continue.
          droppedFiles.push(...batch);
          const isOomDrop =
            error.reason._tag === "OxlintBatchExceeded" && error.reason.kind === "oom";
          if (isOomDrop) oomDroppedFiles.push(...batch);
          let limitHint = "";
          if (isDepthCapReached) {
            limitHint = ` (split depth cap of ${splitMaxDepth} levels reached)`;
          } else if (isBudgetElapsed) {
            limitHint = ` (split budget of ${splitTotalBudgetMs / MILLISECONDS_PER_SECOND}s exhausted at depth ${depth})`;
          }
          const dropReason = batch.length > 1 ? `${error.message}${limitHint}` : error.message;
          firstDropReason ??= dropReason;
          if (!isOomDrop) firstNonOomDropReason ??= dropReason;
          return [];
        }
        const splitIndex = Math.ceil(batch.length / 2);
        return [
          ...(await spawnLintBatch(batch.slice(0, splitIndex), depth + 1, batchState)),
          ...(await spawnLintBatch(batch.slice(splitIndex), depth + 1, batchState)),
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
      passOnFileProgress && totalFileCount > 1
        ? setInterval(() => {
            const ceiling = Math.min(startedFileCount, totalFileCount - 1);
            if (displayedFileCount < ceiling) {
              displayedFileCount += 1;
              passOnFileProgress(displayedFileCount, totalFileCount);
            }
          }, PROGRESS_TICK_INTERVAL_MS)
        : null;
    progressTimer?.unref?.();

    try {
      const batchResults = await mapWithConcurrency(passBatches, concurrency, async (batch) => {
        if (isPastDeadline()) {
          deadlineSkippedFiles.push(...batch);
          return [];
        }
        startedFileCount += batch.length;
        const batchState: { deadlineMs: number | null; deadlineSkippedFileCount: number } = {
          deadlineMs: null,
          deadlineSkippedFileCount: 0,
        };
        const batchDiagnostics = await spawnLintBatch(batch, 0, batchState);
        // A split retry can deadline-skip part of the batch, so count only the
        // files actually linted — not the whole batch — as scanned.
        scannedFileCount += batch.length - batchState.deadlineSkippedFileCount;
        if (passOnFileProgress) {
          displayedFileCount = Math.min(
            Math.max(displayedFileCount, scannedFileCount),
            totalFileCount,
          );
          passOnFileProgress(displayedFileCount, totalFileCount);
        }
        return batchDiagnostics;
      });
      for (const batchDiagnostics of batchResults) allDiagnostics.push(...batchDiagnostics);
    } finally {
      if (progressTimer !== null) clearInterval(progressTimer);
    }

    return {
      diagnostics: allDiagnostics,
      droppedFiles,
      oomDroppedFiles,
      deadlineSkippedFiles,
      firstDropReason,
      firstNonOomDropReason,
    };
  };

  // Parallel runs get one serial retry, but only for the parallelism-exclusive
  // resource exhaustion a single worker can clear. Any other error — or a run
  // that was already serial — would recur, so it propagates.
  let outcome: BatchPassOutcome;
  let effectiveConcurrency = requestedConcurrency;
  try {
    outcome = await runBatchPass(requestedConcurrency, fileBatches, onFileProgress);
  } catch (error) {
    if (requestedConcurrency <= MIN_SCAN_CONCURRENCY || !isParallelismRelatedSpawnError(error)) {
      throw error;
    }
    effectiveConcurrency = MIN_SCAN_CONCURRENCY;
    outcome = await runBatchPass(MIN_SCAN_CONCURRENCY, fileBatches, onFileProgress);
  }

  let { droppedFiles, firstDropReason } = outcome;
  const diagnostics = outcome.diagnostics;
  // OOM rescue: a SIGABRT in oxlint's fixed-size allocator is usually caused
  // by N sibling oxlint processes competing for memory, not by the files
  // themselves. Replay just the OOM-dropped files serially, one single-file
  // batch each (progress reporting stays with the main pass), and keep only
  // the files that STILL fail as dropped. Deadline pressure skips the rescue —
  // those files are already recorded as dropped.
  if (
    outcome.oomDroppedFiles.length > 0 &&
    effectiveConcurrency > MIN_SCAN_CONCURRENCY &&
    !isPastDeadline()
  ) {
    rescueDeadlineEpochMs = Date.now() + OXLINT_OOM_RESCUE_BUDGET_MS;
    // The rescue is strictly additive: it replays files that already crashed
    // oxlint once, so a second, non-splittable failure mode (spawn error,
    // garbled output) is realistic. Each file replays in its own single-file
    // pass with its own recovery, so one file's rescue failure leaves just
    // that file dropped (with its reason) while the completed main pass AND
    // every rescue that already succeeded are kept — a rescue can only ever
    // improve on the pre-rescue outcome of partial results plus a warning.
    const rescuedFiles = new Set<string>();
    let firstRescueFailureReason: string | null = null;
    for (const oomDroppedFile of outcome.oomDroppedFiles) {
      if (isPastDeadline()) break;
      try {
        const rescueOutcome = await runBatchPass(
          MIN_SCAN_CONCURRENCY,
          [[oomDroppedFile]],
          undefined,
        );
        diagnostics.push(...rescueOutcome.diagnostics);
        const didFileStillFail =
          rescueOutcome.droppedFiles.length > 0 || rescueOutcome.deadlineSkippedFiles.length > 0;
        if (didFileStillFail) {
          firstRescueFailureReason ??= rescueOutcome.firstDropReason;
        } else {
          rescuedFiles.add(oomDroppedFile);
        }
      } catch (error) {
        firstRescueFailureReason ??= error instanceof Error ? error.message : String(error);
      }
    }
    rescueDeadlineEpochMs = undefined;
    droppedFiles = droppedFiles.filter((filePath) => !rescuedFiles.has(filePath));
    // Reattribute the "first failure" hint: once the OOM drops are rescued,
    // pointing the report at the (cleared) OOM would name a failure class
    // that no longer applies to any remaining dropped file.
    if (droppedFiles.length === 0) firstDropReason = null;
    else {
      firstDropReason =
        firstRescueFailureReason ?? outcome.firstNonOomDropReason ?? firstDropReason;
    }
  }

  // Report skipped files once, after any rescue, so a fully rescued scan is
  // NOT reported partial (a partial report causes downstream consumers to
  // refuse the whole scan).
  const reportSkippedFiles = (
    skippedFiles: ReadonlyArray<string>,
    buildMessage: (fileListPreview: string) => string,
  ): void => {
    if (skippedFiles.length === 0 || !onPartialFailure) return;
    const previewFiles = skippedFiles.slice(0, OXLINT_PARTIAL_FAILURE_PREVIEW_COUNT).join(", ");
    const remainderHint =
      skippedFiles.length > OXLINT_PARTIAL_FAILURE_PREVIEW_COUNT
        ? `, +${skippedFiles.length - OXLINT_PARTIAL_FAILURE_PREVIEW_COUNT} more`
        : "";
    onPartialFailure(buildMessage(`${previewFiles}${remainderHint}`));
  };
  const reasonHint = firstDropReason ? ` — first failure: ${firstDropReason}` : "";
  reportSkippedFiles(
    droppedFiles,
    (fileListPreview) =>
      `${droppedFiles.length} file(s) failed to lint and were skipped (${fileListPreview})${reasonHint}`,
  );
  reportSkippedFiles(
    outcome.deadlineSkippedFiles,
    (fileListPreview) =>
      `${outcome.deadlineSkippedFiles.length} file(s) skipped — max scan duration reached before they were linted (${fileListPreview})`,
  );
  return dedupeDiagnostics(diagnostics);
};
