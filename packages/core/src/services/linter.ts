import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import type { Diagnostic, ProjectInfo, ReactDoctorConfig } from "@react-doctor/types";
import { OxlintSpawnFailed, ReactDoctorError } from "../errors.js";
import { runOxlint } from "../run-oxlint.js";
import { Reporter } from "./reporter.js";

export interface LintInput {
  readonly rootDirectory: string;
  readonly project: ProjectInfo;
  readonly includePaths?: ReadonlyArray<string>;
  readonly customRulesOnly?: boolean;
  readonly respectInlineDisables?: boolean;
  readonly adoptExistingLintConfig?: boolean;
  readonly ignoredTags?: ReadonlySet<string>;
  readonly userConfig?: ReactDoctorConfig | null;
  readonly nodeBinaryPath?: string;
}

/**
 * runOxlint already raises tagged errors (PR 2). Narrow whatever
 * `tryPromise` caught: tagged errors pass through unchanged,
 * anything else (an unexpected JS-level throw — e.g. fs permission
 * on the temp config dir) wraps in `OxlintSpawnFailed` so the
 * failure channel stays uniform.
 */
const ensureReactDoctorError = (cause: unknown): ReactDoctorError =>
  cause instanceof ReactDoctorError
    ? cause
    : new ReactDoctorError({ reason: new OxlintSpawnFailed({ cause }) });

/**
 * `Linter` is the cross-backend service for "produce diagnostics for
 * an input." Today the only live layer is `layerOxlint` — wrapping
 * the subprocess runner from `core/run-oxlint.ts`. A second backend
 * (in-process ESLint, sandboxed runner) is one new layer that
 * satisfies this interface; the orchestrator doesn't change.
 *
 * `run` returns a `Stream<Diagnostic, ReactDoctorError>` so callers
 * can compose with `Stream.mapEffect` / `filter` / a sink without
 * collecting an array, and so a future daemon backend that emits as
 * it goes can push diagnostics through the stream directly.
 */
export class Linter extends Context.Service<
  Linter,
  {
    readonly run: (input: LintInput) => Stream.Stream<Diagnostic, ReactDoctorError, Reporter>;
  }
>()("react-doctor/Linter") {
  /**
   * Wraps the existing `runOxlint`. Soft per-batch failures
   * (one batch hit the timeout and was dropped, oxlint reported file
   * IDs that couldn't be linted) flow through `Reporter.partialFailure`
   * so the orchestrator surfaces them via `skippedCheckReasons["lint:partial"]`
   * without the stream itself becoming a failure channel for
   * non-fatal events.
   *
   * HACK: runOxlint's onPartialFailure is callback-shaped, so we
   * `Effect.runSync` the reporter call inside the callback. Acceptable
   * until runOxlint itself returns a Stream natively (follow-up PR
   * after this stack lands).
   */
  static readonly layerOxlint = Layer.succeed(
    Linter,
    Linter.of({
      run: (input) =>
        Stream.unwrap(
          Effect.gen(function* () {
            const reporter = yield* Reporter;
            const diagnostics = yield* Effect.tryPromise({
              try: () =>
                runOxlint({
                  rootDirectory: input.rootDirectory,
                  project: input.project,
                  includePaths: input.includePaths ? [...input.includePaths] : undefined,
                  nodeBinaryPath: input.nodeBinaryPath,
                  customRulesOnly: input.customRulesOnly,
                  respectInlineDisables: input.respectInlineDisables,
                  adoptExistingLintConfig: input.adoptExistingLintConfig,
                  ignoredTags: input.ignoredTags,
                  userConfig: input.userConfig ?? null,
                  onPartialFailure: (reason) => {
                    Effect.runSync(reporter.partialFailure(reason));
                  },
                }),
              catch: ensureReactDoctorError,
            });
            return Stream.fromIterable(diagnostics);
          }),
        ),
    }),
  );

  /**
   * Test layer that emits the supplied diagnostics regardless of
   * input. The `layerNoop` from PR 304's plan collapses here:
   * an empty noop is `Linter.layerOf([])`.
   */
  static readonly layerOf = (diagnostics: ReadonlyArray<Diagnostic>): Layer.Layer<Linter> =>
    Layer.succeed(
      Linter,
      Linter.of({
        run: () => Stream.fromIterable(diagnostics),
      }),
    );

  /**
   * Composite layer: runs every supplied backend in sequence and
   * concatenates their diagnostic streams. Slot for a future
   * second-backend integration (ESLint worker pool, sandboxed runner)
   * — register an additional Linter instance and pass the array here
   * without changing the orchestrator.
   */
  static readonly layerComposite = (
    backends: ReadonlyArray<Linter["Service"]>,
  ): Layer.Layer<Linter> =>
    Layer.succeed(
      Linter,
      Linter.of({
        run: (input) => {
          if (backends.length === 0) return Stream.empty;
          let stream = backends[0].run(input);
          for (let index = 1; index < backends.length; index++) {
            stream = stream.pipe(Stream.concat(backends[index].run(input)));
          }
          return stream;
        },
      }),
    );
}
