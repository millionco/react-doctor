import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type { Diagnostic, ProjectInfo, ReactDoctorConfig } from "../types/index.js";
import { OxlintSpawnFailed, ReactDoctorError } from "../errors.js";
import { runOxlint } from "../run-oxlint.js";

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

export interface LintOutcome {
  readonly diagnostics: ReadonlyArray<Diagnostic>;
  readonly partialFailures: ReadonlyArray<string>;
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
 * an input." Today the live layer is `layerOxlint`, wrapping the
 * array-shaped subprocess runner from `core/run-oxlint.ts`. The
 * service returns the array-shaped `LintOutcome` honestly — callers
 * get diagnostics and non-fatal per-batch failures together instead
 * of coordinating a fake diagnostic stream with a side-channel Ref.
 */
export class Linter extends Context.Service<
  Linter,
  {
    readonly run: (input: LintInput) => Effect.Effect<LintOutcome, ReactDoctorError>;
  }
>()("react-doctor/Linter") {
  /**
   * Wraps the existing `runOxlint`. Per-batch soft failures (one
   * batch hit the timeout and was dropped, oxlint reported file IDs
   * that couldn't be linted) flow into the returned outcome so the
   * orchestrator surfaces them via
   * `skippedCheckReasons["lint:partial"]` without an ambient service.
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
        // `Effect.fn("Linter.run")` lights up the lint pass as a
        // single named span in OTel traces. Wraps the inner `runOxlint`
        // call and returns diagnostics + partial failures as one value.
        Effect.fn("Linter.run")(function* () {
          const partialFailures: string[] = [];
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
                  partialFailures.push(reason);
                },
              }),
            catch: ensureReactDoctorError,
          });
          return { diagnostics, partialFailures } satisfies LintOutcome;
        })(),
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
        run: () => Effect.succeed({ diagnostics, partialFailures: [] }),
      }),
    );

  /**
   * Composite layer: runs every supplied backend in sequence and merges
   * their outcomes. Slot for a future
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
        run: (input) =>
          Effect.gen(function* () {
            const diagnostics: Diagnostic[] = [];
            const partialFailures: string[] = [];
            for (const backend of backends) {
              const outcome = yield* backend.run(input);
              diagnostics.push(...outcome.diagnostics);
              partialFailures.push(...outcome.partialFailures);
            }
            return { diagnostics, partialFailures } satisfies LintOutcome;
          }),
      }),
    );
}
