import * as Effect from "effect/Effect";
import * as Filter from "effect/Filter";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";
import type {
  Diagnostic,
  DiagnosticSurface,
  ProjectInfo,
  ReactDoctorConfig,
  ScoreResult,
} from "./types/index.js";
import { buildDiagnosticPipeline } from "./build-diagnostic-pipeline.js";
import { checkInstallHardening } from "./check-install-hardening.js";
import { checkReducedMotion } from "./check-reduced-motion.js";
import { computeJsxIncludePaths } from "./jsx-include-paths.js";
import { NoReactDependency, ReactDoctorError, type ReactDoctorErrorReason } from "./errors.js";
import { filterDiagnosticsForSurface } from "./filter-for-surface.js";
import { resolveLintIncludePaths } from "./resolve-lint-include-paths.js";
import { Config, type ResolvedConfig } from "./services/config.js";
import { DeadCode } from "./services/dead-code.js";
import { Files } from "./services/files.js";
import { Git } from "./services/git.js";
import { LintPartialFailures, Linter } from "./services/linter.js";
import { Progress } from "./services/progress.js";
import { Project } from "./services/project.js";
import { Reporter } from "./services/reporter.js";
import { Score } from "./services/score.js";
import type { ScoreRequestMetadata } from "./calculate-score.js";
import { resolveGithubActionsScoreMetadata } from "./utils/resolve-github-actions-score-metadata.js";

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
  /** react-doctor release version sent with score requests. */
  readonly doctorVersion?: string;
  /** Enables best-effort authenticated local GitHub permission lookup for score metadata. */
  readonly resolveLocalGithubViewerPermission?: boolean;
  /**
   * Diagnostic surface fed to the Score service. Defaults to `"score"`,
   * which excludes weak-signal rule families (e.g. `design`-tagged) from
   * the score so they can't dilute the headline number. Public-API shells
   * (`inspect()` / `diagnose()`) leave this at the default; pass `"cli"`
   * (or any other surface) to score against an unfiltered diagnostic set.
   *
   * The returned `InspectOutput.diagnostics` is always the full
   * per-element-filtered list — surface filtering only affects scoring.
   */
  readonly scoreSurface?: DiagnosticSurface;
}

export interface InspectOutput {
  readonly project: ProjectInfo;
  readonly userConfig: ReactDoctorConfig | null;
  readonly resolvedDirectory: string;
  readonly diagnostics: ReadonlyArray<Diagnostic>;
  readonly score: ScoreResult | null;
  readonly scoreMetadata: ScoreRequestMetadata;
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
 * Today the CLI uses `beforeLint` to render the project-detection
 * block before lint runs; `afterLint` is invoked once lint (and any
 * downstream dead-code) finishes so the caller can attach side-effects
 * keyed on whether lint failed. Per-phase spinner reporting is owned
 * by the `Progress` service — the caller provides `Progress.layerOra`
 * or `Progress.layerNoop` rather than threading spinner handles
 * through hooks.
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

const LINT_FAIL_TEXT = "Lint checks failed (non-fatal, skipping).";
const LINT_SUCCESS_TEXT = "Running lint checks.";
const LINT_NATIVE_BINDING_FAIL_TEXT = (nodeVersion: string): string =>
  `Lint checks failed — oxlint native binding not found (Node ${nodeVersion}).`;

const DEAD_CODE_FAIL_TEXT = "Dead-code analysis failed (non-fatal, skipping).";
const DEAD_CODE_SUCCESS_TEXT = "Analyzing dead code.";

const formatLintFailText = (
  reasonTag: ReactDoctorErrorReason["_tag"] | null,
  nodeVersion: string,
): string => {
  if (reasonTag === "OxlintUnavailable" || reasonTag === "OxlintSpawnFailed") {
    return LINT_NATIVE_BINDING_FAIL_TEXT(nodeVersion);
  }
  return LINT_FAIL_TEXT;
};

/**
 * The full inspect orchestration as a single composable Effect.
 *
 * Phases (each one is a separate `Stream.runCollect` so the
 * `Progress` service can render a per-phase status line):
 *
 *   1. Config.resolve(directory) → Project.discover → Git metadata
 *   2. beforeLint hook (e.g. CLI renders the project-detection block)
 *   3. environment checks (reduced-motion + pnpm hardening) — emitted
 *      through the per-element pipeline so they participate in
 *      auto-suppress / severity / ignore / inline rules.
 *   4. Linter.run — fold `ReactDoctorError` into Ref state so a
 *      lint failure surfaces via `skippedCheckReasons` rather than
 *      sinking the whole scan. Wrapped in `Progress.start("Running
 *      lint checks...")` for terminal feedback.
 *   5. afterLint hook
 *   6. DeadCode.run (gated on `runDeadCode && !isDiffMode`) — same
 *      Ref-fold pattern. Wrapped in `Progress.start("Analyzing dead
 *      code...")`.
 *   7. Reporter.finalize (side-channel: future LSP / NDJSON)
 *   8. Score.compute against the surface-filtered diagnostic set
 *
 * The orchestrator owns spinner lifecycle via `Progress`; callers
 * choose `Progress.layerOra(...)` for CLI feedback or
 * `Progress.layerNoop` for silent / programmatic runs.
 */
export const runInspect = <HooksR = never>(
  input: InspectInput,
  hooks: InspectHooks<HooksR> = {},
): Effect.Effect<
  InspectOutput,
  ReactDoctorError,
  | Project
  | Config
  | DeadCode
  | Files
  | Git
  | Linter
  | LintPartialFailures
  | Progress
  | Reporter
  | Score
  | HooksR
> =>
  Effect.gen(function* () {
    const projectService = yield* Project;
    const configService = yield* Config;
    const filesService = yield* Files;
    const linterService = yield* Linter;
    const reporterService = yield* Reporter;
    const scoreService = yield* Score;
    const deadCodeService = yield* DeadCode;
    const gitService = yield* Git;
    const progressService = yield* Progress;
    const partialFailuresRef = yield* LintPartialFailures;

    const resolvedConfig: ResolvedConfig = yield* configService.resolve(input.directory);
    const scanDirectory = resolvedConfig.resolvedDirectory;

    const project = yield* projectService.discover(scanDirectory);
    if (project.reactVersion === null) {
      return yield* new ReactDoctorError({
        reason: new NoReactDependency({ directory: scanDirectory }),
      });
    }
    const [repo, sha, defaultBranch] = yield* Effect.all(
      [
        gitService
          .githubRepo(scanDirectory)
          .pipe(Effect.orElseSucceed(() => null as string | null)),
        gitService.headSha(scanDirectory).pipe(Effect.orElseSucceed(() => null as string | null)),
        gitService
          .defaultBranch(scanDirectory)
          .pipe(Effect.orElseSucceed(() => null as string | null)),
      ],
      { concurrency: 3 },
    );
    const githubActionsScoreMetadata = input.isCi ? resolveGithubActionsScoreMetadata() : {};
    const githubViewerPermission =
      input.resolveLocalGithubViewerPermission === true && !input.isCi && repo !== null
        ? yield* gitService
            .githubViewerPermission({ directory: scanDirectory, repo })
            .pipe(Effect.orElseSucceed(() => null as string | null))
        : null;
    const scoreMetadata: ScoreRequestMetadata = {
      ...(repo !== null ? { repo } : {}),
      ...(sha !== null ? { sha } : {}),
      framework: project.framework,
      ...(project.reactVersion !== null ? { reactVersion: project.reactVersion } : {}),
      sourceFileCount: project.sourceFileCount,
      ...(defaultBranch !== null ? { defaultBranch } : {}),
      ...(input.doctorVersion !== undefined ? { doctorVersion: input.doctorVersion } : {}),
      ...githubActionsScoreMetadata,
      ...(githubViewerPermission !== null ? { githubViewerPermission } : {}),
    };

    const jsxIncludePaths = computeJsxIncludePaths([...input.includePaths]);
    const lintIncludePaths =
      jsxIncludePaths ?? resolveLintIncludePaths(scanDirectory, resolvedConfig.config);

    const beforeLint = hooks.beforeLint ?? NO_HOOKS.beforeLint;
    const afterLint = hooks.afterLint ?? NO_HOOKS.afterLint;
    yield* beforeLint(project, lintIncludePaths ?? undefined);

    const isDiffMode = input.includePaths.length > 0;

    const transform = buildDiagnosticPipeline({
      rootDirectory: scanDirectory,
      userConfig: resolvedConfig.config,
      readFileLinesSync: fileReader(filesService, scanDirectory),
      respectInlineDisables: input.respectInlineDisables,
    });

    const applyPerElementPipeline = <ToEnv>(rawStream: Stream.Stream<Diagnostic, never, ToEnv>) =>
      rawStream.pipe(
        Stream.filterMap(filterMapNullable<Diagnostic, Diagnostic>(transform.apply)),
        Stream.tap((diagnostic) => reporterService.emit(diagnostic)),
      );

    // ── Phase: environment checks ──────────────────────────────────
    const environmentDiagnostics: ReadonlyArray<Diagnostic> = isDiffMode
      ? []
      : [...checkReducedMotion(scanDirectory), ...checkInstallHardening(scanDirectory)];
    const envCollected = yield* Stream.runCollect(
      applyPerElementPipeline(Stream.fromIterable(environmentDiagnostics)),
    );

    // ── Phase: lint ───────────────────────────────────────────────
    const lintFailure = yield* Ref.make<{
      didFail: boolean;
      reason: string | null;
      reasonTag: ReactDoctorErrorReason["_tag"] | null;
    }>({ didFail: false, reason: null, reasonTag: null });

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
              return Stream.empty as Stream.Stream<Diagnostic, never>;
            }),
          ),
        ),
      );

    const lintProgress = yield* progressService.start("Running lint checks...");
    const lintCollected = yield* Stream.runCollect(applyPerElementPipeline(rawLintStream));
    const lintFailureState = yield* Ref.get(lintFailure);
    if (lintFailureState.didFail) {
      yield* lintProgress.fail(formatLintFailText(lintFailureState.reasonTag, process.version));
    } else {
      yield* lintProgress.succeed(LINT_SUCCESS_TEXT);
    }
    yield* afterLint(lintFailureState.didFail);

    // ── Phase: dead-code (gated on runDeadCode && !isDiffMode) ────
    const shouldRunDeadCode = input.runDeadCode && !isDiffMode;
    const deadCodeFailure = yield* Ref.make<{ didFail: boolean; reason: string | null }>({
      didFail: false,
      reason: null,
    });
    let deadCodeCollected: Iterable<Diagnostic> = [];
    if (shouldRunDeadCode) {
      const rawDeadCodeStream = deadCodeService
        .run({ rootDirectory: scanDirectory, userConfig: resolvedConfig.config })
        .pipe(
          Stream.catchTag("ReactDoctorError", (error: ReactDoctorError) =>
            Stream.unwrap(
              Effect.gen(function* () {
                yield* Ref.set(deadCodeFailure, {
                  didFail: true,
                  reason: error.message,
                });
                return Stream.empty as Stream.Stream<Diagnostic, never>;
              }),
            ),
          ),
        );
      const deadCodeProgress = yield* progressService.start("Analyzing dead code...");
      deadCodeCollected = yield* Stream.runCollect(applyPerElementPipeline(rawDeadCodeStream));
      const deadCodeFailureStateInline = yield* Ref.get(deadCodeFailure);
      if (deadCodeFailureStateInline.didFail) {
        yield* deadCodeProgress.fail(DEAD_CODE_FAIL_TEXT);
      } else {
        yield* deadCodeProgress.succeed(DEAD_CODE_SUCCESS_TEXT);
      }
    }
    const deadCodeFailureState = yield* Ref.get(deadCodeFailure);

    yield* reporterService.finalize;

    const finalDiagnostics: ReadonlyArray<Diagnostic> = [
      ...envCollected,
      ...lintCollected,
      ...deadCodeCollected,
    ];

    // Score is computed off the surface-filtered diagnostic set so
    // weak-signal rule families (design cleanup, etc.) can't dilute
    // the headline number. The full `finalDiagnostics` array is what
    // the caller sees on `InspectOutput.diagnostics`; only the score
    // input is narrowed.
    const scoreSurface: DiagnosticSurface = input.scoreSurface ?? "score";
    const scoreDiagnostics = filterDiagnosticsForSurface(
      [...finalDiagnostics],
      scoreSurface,
      resolvedConfig.config,
    );
    const score = lintFailureState.didFail
      ? null
      : yield* scoreService.compute({
          diagnostics: scoreDiagnostics,
          isCi: input.isCi,
          metadata: scoreMetadata,
        });
    const lintPartialFailures = yield* Ref.get(partialFailuresRef);

    return {
      project,
      userConfig: resolvedConfig.config,
      resolvedDirectory: scanDirectory,
      diagnostics: finalDiagnostics,
      score,
      scoreMetadata,
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
        "inspect.scoreSurface": input.scoreSurface ?? "score",
      },
    }),
  );

/**
 * Default layer stack for the production CLI / programmatic API:
 * real Node-side services for Project / Config / Files / Git / Linter /
 * DeadCode; HTTP for Score; noop Progress (the CLI overrides with
 * `Progress.layerOra(...)` for terminal feedback); the silent Reporter
 * (the orchestrator already returns the diagnostic array via
 * `Stream.runCollect`).
 *
 * Callers tweak by replacing individual layers: `--no-score` swaps
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
  Git.layerNode,
  Linter.layerOxlint,
  LintPartialFailures.layerLive,
  Progress.layerNoop,
  Reporter.layerNoop,
  Score.layerHttp,
);
