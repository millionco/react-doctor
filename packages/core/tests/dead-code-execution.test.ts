import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";
import { describe, expect, it } from "vite-plus/test";
import { buildDeadCodePlan } from "../src/build-dead-code-plan.js";
import { DEAD_CODE_PHASE_TIMEOUT_MS } from "../src/constants.js";
import { type DeadCodeFailureState, startDeadCodeExecution } from "../src/dead-code-execution.js";
import { DeadCodeAnalysisFailed, ReactDoctorError } from "../src/errors.js";
import { DeadCode } from "../src/services/dead-code.js";
import type { ProgressHandle } from "../src/services/progress.js";
import type { Diagnostic } from "../src/types/index.js";
import { resolveDeadCodeTimeout } from "../src/utils/resolve-dead-code-timeout.js";

const ROOT_DIRECTORY = "/repo";
const SCAN_CONCURRENCY = 4;
const DISCOVERED_FILE_COUNT = 8;
const SHORT_TIMEOUT_MS = 20;

const diagnostic: Diagnostic = {
  filePath: "/repo/src/unused.ts",
  plugin: "deslop",
  rule: "unused-file",
  severity: "warning",
  message: "Unused file",
  help: "Remove the unused file.",
  line: 1,
  column: 1,
  category: "Maintainability",
};

const buildPlan = (overlapMode: "on" | "off") =>
  buildDeadCodePlan({
    runDeadCode: true,
    isDiffMode: false,
    showWarnings: true,
    userConfig: null,
    overlapMode,
    scanConcurrency: SCAN_CONCURRENCY,
  });

const makeProgress = (events: string[]): ProgressHandle => ({
  update: (text) =>
    Effect.sync(() => {
      events.push(`progress:${text}`);
    }),
  succeed: () => Effect.void,
  fail: () => Effect.void,
  stop: () => Effect.void,
});

const makeFailure = (): Effect.Effect<Ref.Ref<DeadCodeFailureState>> =>
  Ref.make({ didFail: false, reason: null });

describe("startDeadCodeExecution", () => {
  it("defers sequential work until settle and preserves callbacks, progress, and diagnostics", async () => {
    const events: string[] = [];
    let parseConcurrency: number | undefined;
    let workerTimeoutMs: number | undefined;
    const deadCodeService = DeadCode.of({
      run: (input) => {
        events.push("run");
        parseConcurrency = input.parseConcurrency;
        workerTimeoutMs = input.workerTimeoutMs;
        input.onCacheOutcome?.(true);
        input.onSummaryCacheStats?.({ hits: 5, misses: 2 });
        return Stream.fromIterable([diagnostic]);
      },
    });

    const { eventsBeforeSettle, result } = await Effect.runPromise(
      Effect.gen(function* () {
        const failure = yield* makeFailure();
        const execution = yield* startDeadCodeExecution({
          deadCodeService,
          failureRef: failure,
          plan: buildPlan("off"),
          rootDirectory: ROOT_DIRECTORY,
          discoveredSourceFileCount: DISCOVERED_FILE_COUNT,
          scanConcurrency: SCAN_CONCURRENCY,
          configuredPhaseTimeoutMs: DEAD_CODE_PHASE_TIMEOUT_MS,
          deadlineEpochMs: undefined,
          processDiagnostics: (stream) =>
            stream.pipe(
              Stream.tap(() =>
                Effect.sync(() => {
                  events.push("diagnostic");
                }),
              ),
            ),
        });
        const eventsBeforeSettle = [...events];
        const result = yield* execution.settle({
          lintDidFail: false,
          totalFileCount: 3,
          scannedFilesLabel: "3 files",
          progress: makeProgress(events),
        });
        return { eventsBeforeSettle, result };
      }),
    );

    expect(eventsBeforeSettle).toEqual([]);
    expect(events).toEqual([
      "progress:Scanned 3 files, analyzing dead code...",
      "run",
      "diagnostic",
    ]);
    expect(parseConcurrency).toBeUndefined();
    expect(workerTimeoutMs).toBe(
      resolveDeadCodeTimeout({
        sourceFileCount: 3,
        deadCodeConcurrency: SCAN_CONCURRENCY,
        fullConcurrency: SCAN_CONCURRENCY,
      }).workerTimeoutMs,
    );
    expect(result).toEqual({
      diagnostics: [diagnostic],
      failure: { didFail: false, reason: null },
      cacheHit: true,
      summaryCacheHits: 5,
      summaryCacheMisses: 2,
    });
  });

  it("starts overlap before settle and joins its existing result", async () => {
    const events: string[] = [];
    let parseConcurrency: number | undefined;
    let workerTimeoutMs: number | undefined;

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const started = yield* Deferred.make<void>();
        const release = yield* Deferred.make<void>();
        const failure = yield* makeFailure();
        const execution = yield* startDeadCodeExecution({
          deadCodeService: DeadCode.of({
            run: (input) => {
              parseConcurrency = input.parseConcurrency;
              workerTimeoutMs = input.workerTimeoutMs;
              return Stream.fromEffect(
                Effect.gen(function* () {
                  events.push("started");
                  yield* Deferred.succeed(started, undefined);
                  yield* Deferred.await(release);
                  events.push("completed");
                  return diagnostic;
                }),
              );
            },
          }),
          failureRef: failure,
          plan: buildPlan("on"),
          rootDirectory: ROOT_DIRECTORY,
          discoveredSourceFileCount: DISCOVERED_FILE_COUNT,
          scanConcurrency: SCAN_CONCURRENCY,
          configuredPhaseTimeoutMs: DEAD_CODE_PHASE_TIMEOUT_MS,
          deadlineEpochMs: undefined,
          processDiagnostics: (stream) => stream,
        });

        yield* Deferred.await(started);
        events.push("lint-settled");
        yield* Deferred.succeed(release, undefined);
        return yield* execution.settle({
          lintDidFail: false,
          totalFileCount: 3,
          scannedFilesLabel: "3 files",
          progress: makeProgress(events),
        });
      }),
    );

    expect(events).toEqual([
      "started",
      "lint-settled",
      "progress:Scanned 3 files, analyzing dead code...",
      "completed",
    ]);
    const overlapPlan = buildPlan("on");
    expect(parseConcurrency).toBe(overlapPlan.parseConcurrency);
    expect(workerTimeoutMs).toBe(
      resolveDeadCodeTimeout({
        sourceFileCount: DISCOVERED_FILE_COUNT,
        deadCodeConcurrency: overlapPlan.parseConcurrency ?? SCAN_CONCURRENCY,
        fullConcurrency: SCAN_CONCURRENCY,
      }).workerTimeoutMs,
    );
    expect(result.diagnostics).toEqual([diagnostic]);
    expect(result.failure).toEqual({ didFail: false, reason: null });
  });

  it("interrupts overlap and lets lint failure override dead-code state", async () => {
    const events: string[] = [];

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const started = yield* Deferred.make<void>();
        const failure = yield* Ref.make<DeadCodeFailureState>({
          didFail: true,
          reason: "Dead-code worker failed first.",
        });
        const execution = yield* startDeadCodeExecution({
          deadCodeService: DeadCode.of({
            run: () =>
              Stream.fromEffect(
                Effect.gen(function* () {
                  yield* Deferred.succeed(started, undefined);
                  return yield* Effect.never;
                }),
              ),
          }),
          failureRef: failure,
          plan: buildPlan("on"),
          rootDirectory: ROOT_DIRECTORY,
          discoveredSourceFileCount: DISCOVERED_FILE_COUNT,
          scanConcurrency: SCAN_CONCURRENCY,
          configuredPhaseTimeoutMs: DEAD_CODE_PHASE_TIMEOUT_MS,
          deadlineEpochMs: undefined,
          processDiagnostics: (stream) => stream,
        });

        yield* Deferred.await(started);
        const result = yield* execution.settle({
          lintDidFail: true,
          totalFileCount: 3,
          scannedFilesLabel: "3 files",
          progress: makeProgress(events),
        });
        return result;
      }),
    );

    expect(events).toEqual([]);
    expect(result.diagnostics).toEqual([]);
    expect(result.failure).toEqual({ didFail: false, reason: null });
  });

  it("skips work at an exhausted deadline with the established failure reason", async () => {
    let runCount = 0;

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const failure = yield* makeFailure();
        const execution = yield* startDeadCodeExecution({
          deadCodeService: DeadCode.of({
            run: () => {
              runCount += 1;
              return Stream.fromIterable([diagnostic]);
            },
          }),
          failureRef: failure,
          plan: buildPlan("off"),
          rootDirectory: ROOT_DIRECTORY,
          discoveredSourceFileCount: DISCOVERED_FILE_COUNT,
          scanConcurrency: SCAN_CONCURRENCY,
          configuredPhaseTimeoutMs: DEAD_CODE_PHASE_TIMEOUT_MS,
          deadlineEpochMs: 0,
          processDiagnostics: (stream) => stream,
        });
        return yield* execution.settle({
          lintDidFail: false,
          totalFileCount: 3,
          scannedFilesLabel: "3 files",
          progress: makeProgress([]),
        });
      }),
    );

    expect(runCount).toBe(0);
    expect(result.diagnostics).toEqual([]);
    expect(result.failure).toEqual({
      didFail: true,
      reason: "Dead-code analysis skipped — max scan duration reached.",
    });
  });

  it("folds timeouts and service failures into the dead-code failure contract", async () => {
    const serviceError = new ReactDoctorError({
      reason: new DeadCodeAnalysisFailed({ cause: "worker crash" }),
    });

    const [timeoutResult, failureResult] = await Promise.all([
      Effect.runPromise(
        Effect.gen(function* () {
          const failure = yield* makeFailure();
          const execution = yield* startDeadCodeExecution({
            deadCodeService: DeadCode.of({ run: () => Stream.never }),
            failureRef: failure,
            plan: buildPlan("off"),
            rootDirectory: ROOT_DIRECTORY,
            discoveredSourceFileCount: DISCOVERED_FILE_COUNT,
            scanConcurrency: SCAN_CONCURRENCY,
            configuredPhaseTimeoutMs: SHORT_TIMEOUT_MS,
            deadlineEpochMs: undefined,
            processDiagnostics: (stream) => stream,
          });
          return yield* execution.settle({
            lintDidFail: false,
            totalFileCount: 3,
            scannedFilesLabel: "3 files",
            progress: makeProgress([]),
          });
        }),
      ),
      Effect.runPromise(
        Effect.gen(function* () {
          const failure = yield* makeFailure();
          const execution = yield* startDeadCodeExecution({
            deadCodeService: DeadCode.of({ run: () => Stream.fail(serviceError) }),
            failureRef: failure,
            plan: buildPlan("off"),
            rootDirectory: ROOT_DIRECTORY,
            discoveredSourceFileCount: DISCOVERED_FILE_COUNT,
            scanConcurrency: SCAN_CONCURRENCY,
            configuredPhaseTimeoutMs: DEAD_CODE_PHASE_TIMEOUT_MS,
            deadlineEpochMs: undefined,
            processDiagnostics: (stream) => stream,
          });
          return yield* execution.settle({
            lintDidFail: false,
            totalFileCount: 3,
            scannedFilesLabel: "3 files",
            progress: makeProgress([]),
          });
        }),
      ),
    ]);

    expect(timeoutResult.diagnostics).toEqual([]);
    expect(timeoutResult.failure).toEqual({
      didFail: true,
      reason: "Dead-code analysis exceeded 0s and was skipped.",
    });
    expect(failureResult.diagnostics).toEqual([]);
    expect(failureResult.failure).toEqual({
      didFail: true,
      reason: serviceError.message,
    });
  });
});
