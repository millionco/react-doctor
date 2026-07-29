import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";
import { MILLISECONDS_PER_SECOND } from "./constants.js";
import { type OxlintUnavailable, ReactDoctorError, type ReactDoctorErrorReason } from "./errors.js";
import { OxlintConcurrency } from "./refs.js";
import type { LintInput, LintPartialFailures, Linter } from "./services/linter.js";
import type { ProgressHandle } from "./services/progress.js";
import type { Reporter } from "./services/reporter.js";
import type { Diagnostic } from "./types/index.js";
import { dedupeRelatedDiagnostics } from "./utils/dedupe-related-diagnostics.js";

export interface LintFailureState {
  readonly didFail: boolean;
  readonly reason: string | null;
  readonly reasonTag: ReactDoctorErrorReason["_tag"] | null;
  readonly reasonKind: OxlintUnavailable["kind"] | null;
}

interface RunLintPhaseInput<HooksEnvironment> {
  readonly linterService: Linter["Service"];
  readonly lintInput: LintInput;
  readonly failureRef: Ref.Ref<LintFailureState>;
  readonly shouldOverrideLintConcurrency: boolean;
  readonly lintConcurrency: number;
  readonly phaseTimeoutMs: number;
  readonly filterDiagnostics: <StreamEnvironment>(
    stream: Stream.Stream<Diagnostic, never, StreamEnvironment>,
  ) => Stream.Stream<Diagnostic, never, StreamEnvironment>;
  readonly reporterService: Reporter["Service"];
  readonly afterLint: (didFail: boolean) => Effect.Effect<void, never, HooksEnvironment>;
  readonly progress: ProgressHandle;
  readonly nodeVersion: string;
}

interface LintPhaseResult {
  readonly diagnostics: ReadonlyArray<Diagnostic>;
  readonly failure: LintFailureState;
}

const LINT_FAIL_TEXT = "Scanning failed (lint, non-fatal).";
const formatLintFailure = (
  reasonTag: ReactDoctorErrorReason["_tag"] | null,
  nodeVersion: string,
): string =>
  reasonTag === "OxlintUnavailable" || reasonTag === "OxlintSpawnFailed"
    ? `Scanning failed — oxlint native binding not found (Node ${nodeVersion}).`
    : LINT_FAIL_TEXT;

export const runLintPhase = <HooksEnvironment = never>(
  input: RunLintPhaseInput<HooksEnvironment>,
): Effect.Effect<LintPhaseResult, never, LintPartialFailures | HooksEnvironment> =>
  Effect.gen(function* () {
    const baseLintStream = input.linterService.run(input.lintInput).pipe(
      Stream.catchTag("ReactDoctorError", (error: ReactDoctorError) =>
        Stream.unwrap(
          Ref.set(input.failureRef, {
            didFail: true,
            reason: error.message,
            reasonTag: error.reason._tag,
            reasonKind: error.reason._tag === "OxlintUnavailable" ? error.reason.kind : null,
          }).pipe(Effect.as(Stream.empty)),
        ),
      ),
    );
    const rawLintStream = input.shouldOverrideLintConcurrency
      ? baseLintStream.pipe(Stream.provideService(OxlintConcurrency, input.lintConcurrency))
      : baseLintStream;
    const filteredDiagnostics = yield* Stream.runCollect(
      input.filterDiagnostics(rawLintStream),
    ).pipe(
      Effect.timeoutOption(input.phaseTimeoutMs),
      Effect.flatMap(
        Option.match({
          onNone: () =>
            Ref.set(input.failureRef, {
              didFail: true,
              reason: `Lint analysis exceeded ${
                input.phaseTimeoutMs / MILLISECONDS_PER_SECOND
              }s and was skipped.`,
              reasonTag: "OxlintBatchExceeded",
              reasonKind: null,
            }).pipe(Effect.as<Diagnostic[]>([])),
          onSome: Effect.succeed,
        }),
      ),
    );
    const diagnostics = dedupeRelatedDiagnostics(filteredDiagnostics);
    yield* Effect.forEach(diagnostics, input.reporterService.emit, { discard: true });
    const failure = yield* Ref.get(input.failureRef);
    yield* input.afterLint(failure.didFail);

    if (failure.didFail) {
      yield* input.progress.fail(formatLintFailure(failure.reasonTag, input.nodeVersion));
    }

    return { diagnostics, failure };
  });
