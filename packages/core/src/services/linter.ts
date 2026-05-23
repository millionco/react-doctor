import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";
import type { Diagnostic, ProjectInfo, ReactDoctorConfig } from "@react-doctor/types";
import { OxlintSpawnFailed, ReactDoctorError } from "../errors.js";
import { runOxlint } from "../run-oxlint.js";

/**
 * Per-batch soft-failure channel from linters (e.g. one batch hit
 * the timeout and was dropped). Separate from `Reporter` because
 * production uses `Reporter.layerNoop` to keep diagnostics from
 * being captured server-side — but partial failures MUST always
 * surface to the orchestrator so the JSON report's
 * `skippedCheckReasons["lint:partial"]` is populated. Tests provide
 * a pre-populated Ref to exercise downstream rendering.
 */
export class LintPartialFailures extends Context.Service<
  LintPartialFailures,
  Ref.Ref<ReadonlyArray<string>>
>()("react-doctor/LintPartialFailures") {
  static readonly layerLive = Layer.effect(
    LintPartialFailures,
    Ref.make<ReadonlyArray<string>>([]),
  );
}

export interface LintInput {
  readonly rootDirectory: string;
  readonly project: ProjectInfo;
  readonly includePaths?: ReadonlyArray<string>;
  readonly customRulesOnly?: boolean;
  readonly respectInlineDisables?: boolean;
  readonly adoptExistingLintConfig?: boolean;
  readonly ignoredTags?: ReadonlySet<string>;
  readonly userConfig?: ReactDoctorConfig | null;
  /**
   * Directory of the config file that declared `userConfig`.
   * Used to resolve `userConfig.plugins` entries — diverges from
   * `rootDirectory` after a `userConfig.rootDir` redirect.
   */
  readonly configSourceDirectory?: string;
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
    readonly run: (
      input: LintInput,
    ) => Stream.Stream<Diagnostic, ReactDoctorError, LintPartialFailures>;
  }
>()("react-doctor/Linter") {
  /**
   * Wraps the existing `runOxlint`. Per-batch soft failures (one
   * batch hit the timeout and was dropped, oxlint reported file IDs
   * that couldn't be linted) flow into the `LintPartialFailures`
   * Ref so the orchestrator surfaces them via
   * `skippedCheckReasons["lint:partial"]` without the stream itself
   * becoming a failure channel for non-fatal events.
   *
   * runOxlint's `onPartialFailure` callback is invoked synchronously
   * during the await, so we collect into a closure-captured array
   * and apply the Ref update once after the promise resolves — no
   * Effect.runSync bridge required.
   */
  static readonly layerOxlint = Layer.succeed(
    Linter,
    Linter.of({
      run: (input) =>
        Stream.unwrap(
          // `Effect.fn("Linter.run")` lights up the lint pass as a
          // single named span in OTel traces. Wraps the inner
          // `runOxlint` call + the partial-failure Ref drain so a
          // user attaching `Otlp.layerJson` sees one parent span
          // ("Linter.run") with `Effect.tryPromise` + `Ref.update`
          // children.
          Effect.fn("Linter.run")(function* () {
            const partialFailures = yield* LintPartialFailures;
            const collectedFailures: string[] = [];
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
                  configSourceDirectory: input.configSourceDirectory,
                  onPartialFailure: (reason) => {
                    collectedFailures.push(reason);
                  },
                }),
              catch: ensureReactDoctorError,
            });
            if (collectedFailures.length > 0) {
              yield* Ref.update(partialFailures, (existing) => [...existing, ...collectedFailures]);
            }
            return Stream.fromIterable(diagnostics);
          })(),
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
