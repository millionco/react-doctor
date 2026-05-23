import * as Effect from "effect/Effect";
import * as Filter from "effect/Filter";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";
import type { Diagnostic, ProjectInfo, ReactDoctorConfig, ScoreResult } from "@react-doctor/types";
import { buildDiagnosticPipeline } from "./build-diagnostic-pipeline.js";
import { checkReducedMotion } from "./check-reduced-motion.js";
import { computeJsxIncludePaths } from "./jsx-include-paths.js";
import { NoReactDependency, ReactDoctorError, type ReactDoctorErrorReason } from "./errors.js";
import { resolveLintIncludePaths } from "./resolve-lint-include-paths.js";
import { Config, type ResolvedConfig } from "./services/config.js";
import { DeadCode } from "./services/dead-code.js";
import { Files } from "./services/files.js";
import { LintPartialFailures, Linter } from "./services/linter.js";
import { Project } from "./services/project.js";
import { Reporter } from "./services/reporter.js";
import { Score } from "./services/score.js";

export interface InspectInput {
  readonly directory: string;
  readonly includePaths: ReadonlyArray<string>;
  readonly customRulesOnly: boolean;
  readonly respectInlineDisables: boolean;
  readonly adoptExistingLintConfig: boolean;
  readonly ignoredTags: ReadonlySet<string>;
  readonly nodeBinaryPath?: string;
  /** Whether dead-code analysis runs. Gated also on `!isDiffMode`. */
  readonly runDeadCode: boolean;
  /** Marks the run as CI-originated for the Score API. */
  readonly isCi: boolean;
}

export interface InspectOutput {
  readonly project: ProjectInfo;
  readonly userConfig: ReactDoctorConfig | null;
  readonly resolvedDirectory: string;
  readonly diagnostics: ReadonlyArray<Diagnostic>;
  readonly score: ScoreResult | null;
  readonly didLintFail: boolean;
  readonly lintFailureReason: string | null;
  /**
   * The `_tag` of `error.reason` when the lint stream raised a
   * `ReactDoctorError`, or `null` otherwise. Lets renderers dispatch
   * on the typed reason without `error.message.includes(...)` style
   * sniffs (e.g. show the "upgrade Node" hint only on
   * `OxlintUnavailable` with `kind: "native-binding-missing"`).
   */
  readonly lintFailureReasonTag: ReactDoctorErrorReason["_tag"] | null;
  readonly lintPartialFailures: ReadonlyArray<string>;
  /** `false` when run-dead-code was disabled, diff/staged mode, or analysis crashed. */
  readonly didDeadCodeFail: boolean;
  readonly deadCodeFailureReason: string | null;
}

/**
 * Hooks the caller participates in without owning the orchestration.
 * Today the CLI uses them to render the project-detection block
 * before lint and to drive the spinner; a future LSP host would
 * publish per-diagnostic notifications by providing a Reporter
 * layer (not a hook).
 */
export interface InspectHooks<HooksR = never> {
  readonly beforeLint?: (
    project: ProjectInfo,
    lintIncludePaths: ReadonlyArray<string> | undefined,
  ) => Effect.Effect<void, never, HooksR>;
  readonly afterLint?: (didFail: boolean) => Effect.Effect<void, never, HooksR>;
}

const NO_HOOKS: Required<InspectHooks<never>> = {
  beforeLint: () => Effect.void,
  afterLint: () => Effect.void,
};

const filterMapNullable = <Input, Output>(
  transform: (value: Input) => Output | null,
): Filter.Filter<Input, Output> =>
  Filter.fromPredicateOption((value) => {
    const result = transform(value);
    return result === null ? Option.none() : Option.some(result);
  });

const fileReader =
  (filesService: Files["Service"], rootDirectory: string) =>
  (filePath: string): string[] | null => {
    const lines = Effect.runSync(filesService.readLines({ filePath, rootDirectory }));
    return lines === null ? null : [...lines];
  };

/**
 * The full inspect orchestration as a single composable Effect.
 *
 * Wires the 8 services into a streaming pipeline:
 *
 *   Config.resolve(directory)
 *     -> Project.discover(resolvedDirectory)
 *     -> Stream.fromIterable(checkReducedMotion env diagnostics)
 *     -> Stream.concat(Linter.run(...))    [folds ReactDoctorError into Ref]
 *     -> Stream.concat(DeadCode.run(...))  [folds Error into Ref]
 *     -> Stream.filterMap(perElementPipeline.apply)  [auto-suppress / severity / ignore / inline]
 *     -> Stream.tap(Reporter.emit)         [side-channel: future LSP / NDJSON]
 *     -> Stream.runCollect
 *     -> Score.compute(filtered)
 *
 * Lint and dead-code failures are folded via `Stream.catchTag` into
 * Ref state on the orchestrator side — they don't sink the whole
 * scan, and the renderer (cli or programmatic api) surfaces them
 * via `skippedCheckReasons`.
 */
export const runInspect = <HooksR = never>(
  input: InspectInput,
  hooks: InspectHooks<HooksR> = {},
): Effect.Effect<
  InspectOutput,
  ReactDoctorError,
  Project | Config | DeadCode | Files | Linter | LintPartialFailures | Reporter | Score | HooksR
> =>
  // `Effect.withSpan("runInspect", { attributes })` turns the entire
  // orchestrator into a single named OTel span; child service spans
  // (`Project.discover`, `Linter.run`, `DeadCode.run`, `Score.compute`)
  // hang off it. With no tracing layer provided, zero runtime cost.
  // With `Otlp.layerJson(...)` provided, the user gets the whole
  // scan as one trace — same shape as `react-doctor-evals`'
  // `Runner.run` / `WorkerPool.invoke` instrumentation.
  Effect.gen(function* () {
    const projectService = yield* Project;
    const configService = yield* Config;
    const filesService = yield* Files;
    const linterService = yield* Linter;
    const reporterService = yield* Reporter;
    const scoreService = yield* Score;
    const deadCodeService = yield* DeadCode;
    const partialFailuresRef = yield* LintPartialFailures;

    const resolvedConfig: ResolvedConfig = yield* configService.resolve(input.directory);
    const scanDirectory = resolvedConfig.resolvedDirectory;

    const project = yield* projectService.discover(scanDirectory);
    if (project.reactVersion === null) {
      return yield* new ReactDoctorError({
        reason: new NoReactDependency({ directory: scanDirectory }),
      });
    }

    const jsxIncludePaths = computeJsxIncludePaths([...input.includePaths]);
    const lintIncludePaths =
      jsxIncludePaths ?? resolveLintIncludePaths(scanDirectory, resolvedConfig.config);

    const beforeLint = hooks.beforeLint ?? NO_HOOKS.beforeLint;
    const afterLint = hooks.afterLint ?? NO_HOOKS.afterLint;
    yield* beforeLint(project, lintIncludePaths ?? undefined);

    const lintFailure = yield* Ref.make<{
      didFail: boolean;
      reason: string | null;
      reasonTag: ReactDoctorErrorReason["_tag"] | null;
    }>({ didFail: false, reason: null, reasonTag: null });

    const deadCodeFailure = yield* Ref.make<{
      didFail: boolean;
      reason: string | null;
    }>({ didFail: false, reason: null });

    const isDiffMode = input.includePaths.length > 0;

    const transform = buildDiagnosticPipeline({
      rootDirectory: scanDirectory,
      userConfig: resolvedConfig.config,
      readFileLinesSync: fileReader(filesService, scanDirectory),
      respectInlineDisables: input.respectInlineDisables,
    });

    const environmentDiagnostics: ReadonlyArray<Diagnostic> = isDiffMode
      ? []
      : checkReducedMotion(scanDirectory);

    const emptyDiagnosticStream: Stream.Stream<Diagnostic, never> = Stream.empty;

    const rawLintStream = linterService
      .run({
        rootDirectory: scanDirectory,
        project,
        includePaths: lintIncludePaths ?? undefined,
        nodeBinaryPath: input.nodeBinaryPath,
        customRulesOnly: input.customRulesOnly,
        respectInlineDisables: input.respectInlineDisables,
        adoptExistingLintConfig: input.adoptExistingLintConfig,
        ignoredTags: input.ignoredTags,
        userConfig: resolvedConfig.config ?? undefined,
        configSourceDirectory: resolvedConfig.configSourceDirectory ?? undefined,
      })
      .pipe(
        Stream.catchTag("ReactDoctorError", (error: ReactDoctorError) =>
          Stream.unwrap(
            Effect.gen(function* () {
              yield* Ref.set(lintFailure, {
                didFail: true,
                reason: error.message,
                reasonTag: error.reason._tag,
              });
              return emptyDiagnosticStream;
            }),
          ),
        ),
      );

    const shouldRunDeadCode = input.runDeadCode && !isDiffMode;
    const deadCodeStream: Stream.Stream<Diagnostic, never> = shouldRunDeadCode
      ? deadCodeService
          .run({ rootDirectory: scanDirectory, userConfig: resolvedConfig.config })
          .pipe(
            Stream.catchTag("ReactDoctorError", (error: ReactDoctorError) =>
              Stream.unwrap(
                Effect.gen(function* () {
                  yield* Ref.set(deadCodeFailure, {
                    didFail: true,
                    reason: error.message,
                  });
                  return emptyDiagnosticStream;
                }),
              ),
            ),
          )
      : emptyDiagnosticStream;

    const transformedStream = Stream.fromIterable(environmentDiagnostics).pipe(
      Stream.concat(rawLintStream),
      Stream.concat(deadCodeStream),
      Stream.filterMap(filterMapNullable<Diagnostic, Diagnostic>(transform.apply)),
      Stream.tap((diagnostic) => reporterService.emit(diagnostic)),
    );

    const survivingDiagnostics = yield* Stream.runCollect(transformedStream);
    yield* reporterService.finalize;

    const lintFailureState = yield* Ref.get(lintFailure);
    const deadCodeFailureState = yield* Ref.get(deadCodeFailure);
    yield* afterLint(lintFailureState.didFail);

    const finalDiagnostics: ReadonlyArray<Diagnostic> = [...survivingDiagnostics];
    const score = lintFailureState.didFail
      ? null
      : yield* scoreService.compute({ diagnostics: finalDiagnostics, isCi: input.isCi });
    const lintPartialFailures = yield* Ref.get(partialFailuresRef);

    return {
      project,
      userConfig: resolvedConfig.config,
      resolvedDirectory: scanDirectory,
      diagnostics: finalDiagnostics,
      score,
      didLintFail: lintFailureState.didFail,
      lintFailureReason: lintFailureState.reason,
      lintFailureReasonTag: lintFailureState.reasonTag,
      lintPartialFailures,
      didDeadCodeFail: deadCodeFailureState.didFail,
      deadCodeFailureReason: deadCodeFailureState.reason,
    };
  }).pipe(
    Effect.withSpan("runInspect", {
      attributes: {
        "inspect.directory": input.directory,
        "inspect.includePathCount": input.includePaths.length,
        "inspect.runDeadCode": input.runDeadCode,
        "inspect.isCi": input.isCi,
      },
    }),
  );

/**
 * Default layer stack for the production CLI / programmatic API:
 * real Node-side services for Project / Config / Files / Linter /
 * DeadCode; HTTP for Score; the silent Reporter (the orchestrator
 * already returns the diagnostic array via `Stream.runCollect`).
 *
 * Callers tweak by replacing individual layers: `--offline` swaps
 * `Score.layerHttp` for `Score.layerOf(null)`; `--no-lint` swaps
 * `Linter.layerOxlint` for `Linter.layerOf([])`; `--no-dead-code`
 * swaps `DeadCode.layerNode` for `DeadCode.layerOf([])`; a caller
 * with a pre-loaded config swaps `Config.layerNode` for
 * `Config.layerOf(resolved)`.
 */
export const layerInspectLive = Layer.mergeAll(
  Project.layerNode,
  Config.layerNode,
  DeadCode.layerNode,
  Files.layerNode,
  Linter.layerOxlint,
  LintPartialFailures.layerLive,
  Reporter.layerNoop,
  Score.layerHttp,
);
