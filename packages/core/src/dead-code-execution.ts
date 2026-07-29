import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";
import type { DeadCodePlan } from "./build-dead-code-plan.js";
import { DEAD_CODE_PHASE_TIMEOUT_MS, MILLISECONDS_PER_SECOND } from "./constants.js";
import { ReactDoctorError } from "./errors.js";
import type { DeadCode } from "./services/dead-code.js";
import type { ProgressHandle } from "./services/progress.js";
import type { Diagnostic } from "./types/index.js";
import { remainingDeadlineBudgetMs } from "./utils/remaining-deadline-budget-ms.js";
import { resolveDeadCodeTimeout } from "./utils/resolve-dead-code-timeout.js";

export interface DeadCodeFailureState {
  readonly didFail: boolean;
  readonly reason: string | null;
}

interface StartDeadCodeExecutionInput {
  readonly deadCodeService: DeadCode["Service"];
  readonly failureRef: Ref.Ref<DeadCodeFailureState>;
  readonly plan: DeadCodePlan;
  readonly rootDirectory: string;
  readonly discoveredSourceFileCount: number;
  readonly scanConcurrency: number;
  readonly configuredPhaseTimeoutMs: number;
  readonly deadlineEpochMs: number | undefined;
  readonly processDiagnostics: (
    stream: Stream.Stream<Diagnostic, never>,
  ) => Stream.Stream<Diagnostic, never>;
}

interface SettleDeadCodeExecutionInput {
  readonly lintDidFail: boolean;
  readonly totalFileCount: number;
  readonly scannedFilesLabel: string;
  readonly progress: ProgressHandle;
}

export interface DeadCodeExecutionResult {
  readonly diagnostics: ReadonlyArray<Diagnostic>;
  readonly failure: DeadCodeFailureState;
  readonly cacheHit: boolean | null;
  readonly summaryCacheHits: number | null;
  readonly summaryCacheMisses: number | null;
}

export interface DeadCodeExecution {
  readonly settle: (input: SettleDeadCodeExecutionInput) => Effect.Effect<DeadCodeExecutionResult>;
}

interface DeadCodeTimeout {
  readonly workerTimeoutMs: number;
  readonly phaseTimeoutMs: number;
}

export const startDeadCodeExecution = (
  input: StartDeadCodeExecutionInput,
): Effect.Effect<DeadCodeExecution> =>
  Effect.gen(function* () {
    let cacheHit: boolean | null = null;
    let summaryCacheHits: number | null = null;
    let summaryCacheMisses: number | null = null;

    const resolvePhaseTimeoutMs = (scaledPhaseTimeoutMs: number): number =>
      input.configuredPhaseTimeoutMs === DEAD_CODE_PHASE_TIMEOUT_MS
        ? scaledPhaseTimeoutMs
        : input.configuredPhaseTimeoutMs;

    const capToDeadline = (phaseTimeoutMs: number): number =>
      input.deadlineEpochMs === undefined
        ? phaseTimeoutMs
        : Math.min(phaseTimeoutMs, remainingDeadlineBudgetMs(input.deadlineEpochMs));

    const collectDiagnostics = (timeout: DeadCodeTimeout) =>
      Stream.runCollect(
        input.processDiagnostics(
          input.deadCodeService
            .run({
              rootDirectory: input.rootDirectory,
              parseConcurrency: input.plan.parseConcurrency,
              workerTimeoutMs: timeout.workerTimeoutMs,
              onCacheOutcome: (didHitCache) => {
                cacheHit = didHitCache;
              },
              onSummaryCacheStats: (stats) => {
                summaryCacheHits = stats.hits;
                summaryCacheMisses = stats.misses;
              },
            })
            .pipe(
              Stream.catchTag("ReactDoctorError", (error: ReactDoctorError) =>
                Stream.unwrap(
                  Ref.set(input.failureRef, {
                    didFail: true,
                    reason: error.message,
                  }).pipe(Effect.as(Stream.empty)),
                ),
              ),
            ),
        ),
      ).pipe(
        Effect.timeoutOption(timeout.phaseTimeoutMs),
        Effect.flatMap(
          Option.match({
            onNone: () =>
              Ref.set(input.failureRef, {
                didFail: true,
                reason: `Dead-code analysis exceeded ${Math.round(
                  timeout.phaseTimeoutMs / MILLISECONDS_PER_SECOND,
                )}s and was skipped.`,
              }).pipe(Effect.as<Diagnostic[]>([])),
            onSome: Effect.succeed,
          }),
        ),
      );

    // Overlap starts before lint. Its timeout uses discovery's file count and
    // the reduced parse share because lint's final file count is not known yet.
    const overlapTimeout = resolveDeadCodeTimeout({
      sourceFileCount: input.discoveredSourceFileCount,
      deadCodeConcurrency: input.plan.parseConcurrency ?? input.scanConcurrency,
      fullConcurrency: input.scanConcurrency,
    });
    const overlapFiber = input.plan.shouldOverlap
      ? yield* Effect.forkChild(
          collectDiagnostics({
            workerTimeoutMs: overlapTimeout.workerTimeoutMs,
            phaseTimeoutMs: capToDeadline(resolvePhaseTimeoutMs(overlapTimeout.phaseTimeoutMs)),
          }),
        )
      : null;

    return {
      settle: (settleInput) =>
        Effect.gen(function* () {
          let diagnostics: ReadonlyArray<Diagnostic> = [];

          if (settleInput.lintDidFail) {
            if (overlapFiber !== null) yield* Fiber.interrupt(overlapFiber);
          } else if (input.plan.shouldRun) {
            const isDeadlineSpent =
              input.deadlineEpochMs !== undefined &&
              remainingDeadlineBudgetMs(input.deadlineEpochMs) === 0;

            if (isDeadlineSpent) {
              if (overlapFiber !== null) yield* Fiber.interrupt(overlapFiber);
              yield* Ref.set(input.failureRef, {
                didFail: true,
                reason: "Dead-code analysis skipped — max scan duration reached.",
              });
            } else {
              yield* settleInput.progress.update(
                `Scanned ${settleInput.scannedFilesLabel}, analyzing dead code...`,
              );

              const sequentialTimeout = resolveDeadCodeTimeout({
                sourceFileCount: settleInput.totalFileCount,
                deadCodeConcurrency: input.scanConcurrency,
                fullConcurrency: input.scanConcurrency,
              });
              diagnostics =
                overlapFiber === null
                  ? yield* collectDiagnostics({
                      workerTimeoutMs: sequentialTimeout.workerTimeoutMs,
                      phaseTimeoutMs: capToDeadline(
                        resolvePhaseTimeoutMs(sequentialTimeout.phaseTimeoutMs),
                      ),
                    })
                  : yield* Fiber.join(overlapFiber);
            }
          }

          return {
            diagnostics,
            failure: settleInput.lintDidFail
              ? { didFail: false, reason: null }
              : yield* Ref.get(input.failureRef),
            cacheHit,
            summaryCacheHits,
            summaryCacheMisses,
          };
        }),
    };
  });
