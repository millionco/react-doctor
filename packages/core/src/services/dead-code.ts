import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import type { Diagnostic, ReactDoctorConfig } from "../types/index.js";
import { checkDeadCode } from "../check-dead-code.js";
import { DeadCodeAnalysisFailed, ReactDoctorError } from "../errors.js";

interface DeadCodeInput {
  readonly rootDirectory: string;
  readonly userConfig: ReactDoctorConfig | null;
  /**
   * Caps deslop's parse pool so it shares cores with a concurrent lint pass
   * instead of oversubscribing. Set by the orchestrator only when dead-code
   * overlaps lint; omitted on the sequential path (deslop uses all cores).
   */
  readonly parseConcurrency?: number;
  /**
   * In-worker SIGKILL deadline, scaled to the repo's file count by the
   * orchestrator (`resolveDeadCodeTimeout`). Omitted → the fixed
   * `DEAD_CODE_WORKER_TIMEOUT_MS` floor.
   */
  readonly workerTimeoutMs?: number;
}

/**
 * `DeadCode` runs whole-project reachability analysis and streams
 * diagnostics. Reachability is a whole-project property — the
 * orchestrator skips this pass in `--diff` / `--staged` mode by
 * providing `layerOf([])`. Failures are folded by the orchestrator
 * into `skippedChecks: ["dead-code"]` without sinking the scan.
 *
 * Stream-shape (matching `Linter.run`) so the orchestrator can
 * `Stream.concat(linter.run, deadCode.run)` symmetrically.
 */
export class DeadCode extends Context.Service<
  DeadCode,
  {
    readonly run: (input: DeadCodeInput) => Stream.Stream<Diagnostic, ReactDoctorError>;
  }
>()("react-doctor/DeadCode") {
  static readonly layerNode = Layer.succeed(
    DeadCode,
    DeadCode.of({
      run: (input) =>
        Stream.unwrap(
          // `Effect.fn("DeadCode.run")` so the dead-code analysis
          // surfaces as a single named span in OTel traces (parent
          // of the per-call `Effect.tryPromise`).
          Effect.fn("DeadCode.run")(function* () {
            return yield* Effect.tryPromise({
              // The signal is wired to fiber interruption: when the
              // orchestrator interrupts this fiber (lint failed / scan
              // cancelled) it aborts here, SIGKILLing the 8 GB worker child
              // instead of orphaning it until the worker timeout.
              try: (signal) =>
                checkDeadCode({
                  rootDirectory: input.rootDirectory,
                  userConfig: input.userConfig,
                  parseConcurrency: input.parseConcurrency,
                  workerTimeoutMs: input.workerTimeoutMs,
                  abortSignal: signal,
                }),
              catch: (cause) =>
                new ReactDoctorError({ reason: new DeadCodeAnalysisFailed({ cause }) }),
            }).pipe(Effect.map((diagnostics) => Stream.fromIterable(diagnostics)));
          })(),
        ),
    }),
  );

  static readonly layerOf = (diagnostics: ReadonlyArray<Diagnostic>): Layer.Layer<DeadCode> =>
    Layer.succeed(
      DeadCode,
      DeadCode.of({
        run: () => Stream.fromIterable(diagnostics),
      }),
    );
}
