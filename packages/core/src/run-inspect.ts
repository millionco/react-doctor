import path from "node:path";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Filter from "effect/Filter";
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
import { checkExpoProject } from "./check-expo-project.js";
import { checkPnpmHardening } from "./check-pnpm-hardening.js";
import { checkReactNativeProject } from "./check-react-native-project.js";
import { checkReducedMotion } from "./check-reduced-motion.js";
import { DEFAULT_SHOW_WARNINGS } from "./constants.js";
import { highlighter } from "./highlighter.js";
import { computeJsxIncludePaths } from "./jsx-include-paths.js";
import { deadCodeMaySurfaceWhenWarningsHidden } from "./utils/dead-code-may-surface.js";
import {
  NoReactDependency,
  type OxlintUnavailable,
  ReactDoctorError,
  type ReactDoctorErrorReason,
} from "./errors.js";
import { filterDiagnosticsForSurface } from "./filter-for-surface.js";
import { isAnalyzableProject } from "./project-info/index.js";
import { OxlintConcurrency } from "./refs.js";
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
  /**
   * Per-call override for `ReactDoctorConfig.warnings`. When omitted,
   * the loaded config's `warnings` value wins (defaulting to `true`),
   * so warnings surface unless the user opts out via `--no-warnings` or
   * `warnings: false`.
   */
  readonly warnings?: boolean;
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
  /**
   * Suppresses the orchestrator's own persistent "Scanned N files"
   * success line. The live scan spinner still runs for feedback but
   * clears on completion instead of leaving a status line behind. The
   * CLI sets this when scanning multiple projects so it can render a
   * single aggregate "Scanned N files" line in their place — the
   * per-project file count + scan duration are surfaced on
   * `InspectOutput` for that summary. Lint / dead-code failures still
   * surface their own spinner state regardless of this flag.
   */
  readonly suppressScanSummary?: boolean;
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
  /**
   * The `kind` of an `OxlintUnavailable` lint failure
   * (`binary-not-found` / `native-binding-missing`), or `null` for any
   * other failure. Lets renderers show the "upgrade Node" hint by
   * dispatching on structured data instead of matching message text.
   */
  readonly lintFailureReasonKind: OxlintUnavailable["kind"] | null;
  readonly lintPartialFailures: ReadonlyArray<string>;
  /** `false` when run-dead-code was disabled, diff/staged mode, or analysis crashed. */
  readonly didDeadCodeFail: boolean;
  readonly deadCodeFailureReason: string | null;
  /**
   * Number of files the scan reported (lint progress total, falling
   * back to the project source-file count). Surfaced so a caller that
   * sets `suppressScanSummary` can render its own aggregate
   * "Scanned N files" line.
   */
  readonly scannedFileCount: number;
  /**
   * Absolute paths of every file this scan considered. Used by the
   * multi-project summary to count UNIQUE files across projects:
   * nested workspace packages (a parent whose tree contains a child
   * package) would otherwise double-count the shared files when their
   * per-project counts are summed.
   */
  readonly scannedFilePaths: ReadonlyArray<string>;
  /** Wall-clock duration of the scan phase, in milliseconds. */
  readonly scanElapsedMilliseconds: number;
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

const LINT_FAIL_TEXT = "Scanning failed (lint, non-fatal).";
const LINT_NATIVE_BINDING_FAIL_TEXT = (nodeVersion: string): string =>
  `Scanning failed — oxlint native binding not found (Node ${nodeVersion}).`;
const DEAD_CODE_FAIL_TEXT = "Scanning failed (dead-code analysis, non-fatal).";

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
 * Phases:
 *
 *   1. Config.resolve(directory) → Project.discover → Git metadata
 *   2. beforeLint hook (e.g. CLI renders the project-detection block)
 *   3. environment checks (reduced-motion + pnpm hardening)
 *   4. Linter.run + DeadCode.run — forked as concurrent fibers so
 *      their wall-clock times overlap. Progress spinners stay
 *      sequential (lint first, then dead-code) for clean terminal
 *      output. GitHub viewer permission also runs as a background
 *      fiber during this phase.
 *   5. afterLint hook
 *   6. Reporter.finalize
 *   7. Score.compute against the surface-filtered diagnostic set
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
    if (!isAnalyzableProject(project)) {
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
    const githubViewerPermissionFiber = yield* Effect.forkChild(
      input.resolveLocalGithubViewerPermission === true && !input.isCi && repo !== null
        ? gitService
            .githubViewerPermission({ directory: scanDirectory, repo })
            .pipe(Effect.orElseSucceed(() => null as string | null))
        : Effect.succeed(null as string | null),
    );

    const jsxIncludePaths = computeJsxIncludePaths([...input.includePaths]);
    const lintIncludePaths =
      jsxIncludePaths ?? resolveLintIncludePaths(scanDirectory, resolvedConfig.config);

    // Absolute paths of the exact file set the linter scans, captured ONLY
    // for the multi-project summary (the sole consumer), which signals via
    // `suppressScanSummary`. Gating avoids a redundant full-tree walk on
    // every single-project / `diagnose()` run — for a full scan the linter
    // already enumerates the same files, so we'd otherwise list twice.
    const scannedFilePaths = input.suppressScanSummary
      ? (lintIncludePaths ?? (yield* filesService.listSourceFiles(scanDirectory))).map(
          (relativePath) => path.resolve(scanDirectory, relativePath),
        )
      : [];

    const beforeLint = hooks.beforeLint ?? NO_HOOKS.beforeLint;
    const afterLint = hooks.afterLint ?? NO_HOOKS.afterLint;
    yield* beforeLint(project, lintIncludePaths ?? undefined);

    const isDiffMode = input.includePaths.length > 0;

    const showWarnings = input.warnings ?? resolvedConfig.config?.warnings ?? DEFAULT_SHOW_WARNINGS;

    const transform = buildDiagnosticPipeline({
      rootDirectory: scanDirectory,
      userConfig: resolvedConfig.config,
      readFileLinesSync: fileReader(filesService, scanDirectory),
      respectInlineDisables: input.respectInlineDisables,
      showWarnings,
    });

    const applyPerElementPipeline = <ToEnv>(rawStream: Stream.Stream<Diagnostic, never, ToEnv>) =>
      rawStream.pipe(
        Stream.filterMap(filterMapNullable<Diagnostic, Diagnostic>(transform.apply)),
        Stream.tap((diagnostic) => reporterService.emit(diagnostic)),
      );

    // ── Phase: environment checks ──────────────────────────────────
    const environmentDiagnostics: ReadonlyArray<Diagnostic> = isDiffMode
      ? []
      : [
          ...checkReducedMotion(scanDirectory),
          ...checkPnpmHardening(scanDirectory),
          ...checkExpoProject(scanDirectory, project),
          ...checkReactNativeProject(scanDirectory, project),
        ];
    const envCollected = yield* Stream.runCollect(
      applyPerElementPipeline(Stream.fromIterable(environmentDiagnostics)),
    );

    const lintFailure = yield* Ref.make<{
      didFail: boolean;
      reason: string | null;
      reasonTag: ReactDoctorErrorReason["_tag"] | null;
      reasonKind: OxlintUnavailable["kind"] | null;
    }>({ didFail: false, reason: null, reasonTag: null, reasonKind: null });
    const deadCodeFailure = yield* Ref.make<{ didFail: boolean; reason: string | null }>({
      didFail: false,
      reason: null,
    });

    // Read only for the spinner suffix below (the Linter reads the same
    // Reference to actually fan out the lint pass); defaults to parallel
    // (auto-detected cores).
    const scanConcurrency = yield* OxlintConcurrency;
    const workerCountSuffix =
      scanConcurrency > 1 ? ` ${highlighter.dim(`[~${scanConcurrency} workers]`)}` : "";

    const scanProgress = yield* progressService.start("Scanning...");
    const scanStartTime = Date.now();
    let lastReportedTotalFileCount = 0;

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
        onFileProgress: (scannedFileCount, totalFileCount) => {
          lastReportedTotalFileCount = totalFileCount;
          Effect.runSync(
            scanProgress.update(
              `Scanning files (${scannedFileCount}/${totalFileCount})${workerCountSuffix}...`,
            ),
          );
        },
      })
      .pipe(
        Stream.catchTag("ReactDoctorError", (error: ReactDoctorError) =>
          Stream.unwrap(
            Effect.gen(function* () {
              yield* Ref.set(lintFailure, {
                didFail: true,
                reason: error.message,
                reasonTag: error.reason._tag,
                reasonKind: error.reason._tag === "OxlintUnavailable" ? error.reason.kind : null,
              });
              return Stream.empty as Stream.Stream<Diagnostic, never>;
            }),
          ),
        ),
      );

    const lintCollected = yield* Stream.runCollect(applyPerElementPipeline(rawLintStream));
    const lintFailureState = yield* Ref.get(lintFailure);
    yield* afterLint(lintFailureState.didFail);

    if (lintFailureState.didFail) {
      yield* scanProgress.fail(formatLintFailText(lintFailureState.reasonTag, process.version));
    }

    // Dead-code analysis only ever emits `"warning"`-severity diagnostics
    // (the `deslop` plugin, all `Maintainability`). Warnings show by
    // default, so this normally runs; only when the user opts out via
    // `--no-warnings` / `warnings: false` is that output filtered out
    // before it reaches any surface or the score, making the expensive
    // pass (separate worker, large heap, long timeout) pure wasted work —
    // so skip it then, unless a severity override restamps dead-code
    // findings to `"warn"`/`"error"` so they survive the global hide.
    const shouldRunDeadCode =
      input.runDeadCode &&
      !isDiffMode &&
      (showWarnings || deadCodeMaySurfaceWhenWarningsHidden(resolvedConfig.config));
    const deadCodeCollected =
      lintFailureState.didFail || !shouldRunDeadCode
        ? []
        : yield* scanProgress.update("Analyzing dead code...").pipe(
            Effect.andThen(
              Stream.runCollect(
                applyPerElementPipeline(
                  deadCodeService
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
                    ),
                ),
              ),
            ),
          );
    const deadCodeFailureState = yield* Ref.get(deadCodeFailure);

    const scanElapsedMilliseconds = Date.now() - scanStartTime;
    const scanElapsedSeconds = (scanElapsedMilliseconds / 1000).toFixed(1);
    const totalFileCount =
      lastReportedTotalFileCount || (lintIncludePaths?.length ?? project.sourceFileCount);

    if (!lintFailureState.didFail) {
      if (deadCodeFailureState.didFail) {
        yield* scanProgress.fail(DEAD_CODE_FAIL_TEXT);
      } else if (input.suppressScanSummary) {
        yield* scanProgress.stop();
      } else {
        yield* scanProgress.succeed(
          `Scanned ${totalFileCount} ${totalFileCount === 1 ? "file" : "files"} in ${scanElapsedSeconds}s${workerCountSuffix}`,
        );
      }
    }

    yield* reporterService.finalize;

    const finalDiagnostics: ReadonlyArray<Diagnostic> = [
      ...envCollected,
      ...lintCollected,
      ...deadCodeCollected,
    ];

    const githubViewerPermission = yield* Fiber.join(githubViewerPermissionFiber);
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
      lintFailureReasonKind: lintFailureState.reasonKind,
      lintPartialFailures,
      didDeadCodeFail: deadCodeFailureState.didFail,
      deadCodeFailureReason: deadCodeFailureState.reason,
      scannedFileCount: totalFileCount,
      scannedFilePaths,
      scanElapsedMilliseconds,
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
