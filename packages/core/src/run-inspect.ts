import * as path from "node:path";
import * as Effect from "effect/Effect";
import * as Filter from "effect/Filter";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";
import type { Diagnostic } from "./types/index.js";
import { assembleInspectOutput, type InspectOutput } from "./assemble-inspect-output.js";
import { startBackgroundAnalyzerExecution } from "./background-analyzer-execution.js";
import { buildLintExecution } from "./build-lint-execution.js";
import { buildDiagnosticPipeline } from "./build-diagnostic-pipeline.js";
import { MILLISECONDS_PER_SECOND } from "./constants.js";
import { buildDeadCodePlan } from "./build-dead-code-plan.js";
import { type DeadCodeFailureState, startDeadCodeExecution } from "./dead-code-execution.js";
import { highlighter } from "./highlighter.js";
import { NoReactDependency, ReactDoctorError, ScanDeadlineExceeded } from "./errors.js";
import { finalizeDiagnosticOutput } from "./finalize-diagnostic-output.js";
import { isAnalyzableProject } from "./project-info/index.js";
import {
  DeadCodeOverlap,
  DeadCodePhaseTimeoutMs,
  LintPhaseTimeoutMs,
  OxlintConcurrency,
  ScanDeadlineMs,
} from "./refs.js";
import { resolveInspectScanSettings } from "./resolve-inspect-scan-settings.js";
import type { InspectHooks, InspectInput } from "./run-inspect-contracts.js";
import { type LintFailureState, runLintPhase } from "./run-lint-phase.js";
import { startScoreMetadataExecution } from "./score-metadata-execution.js";
import { Config, type ResolvedConfig } from "./services/config.js";
import { DeadCode } from "./services/dead-code.js";
import { Files } from "./services/files.js";
import { Git } from "./services/git.js";
import { LintPartialFailures, Linter } from "./services/linter.js";
import { Progress } from "./services/progress.js";
import { Project } from "./services/project.js";
import { ProjectChecks } from "./services/project-checks.js";
import { Reporter } from "./services/reporter.js";
import { Score } from "./services/score.js";
import { SupplyChain } from "./services/supply-chain.js";
import { resolveScanCompletion } from "./utils/resolve-scan-completion.js";
import { resolveScanConcurrency } from "./utils/resolve-scan-concurrency.js";
import { resolveScanFileCoverage } from "./utils/resolve-scan-file-coverage.js";

export type { InspectOutput } from "./assemble-inspect-output.js";
export type { InspectHooks, InspectInput } from "./run-inspect-contracts.js";

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
 * Phases:
 *
 *   1. Config.resolve(directory) → Project.discover → Git metadata.
 *      The GitHub viewer-permission lookup is forked onto a background
 *      fiber here and joined late (it feeds score metadata, not
 *      diagnostics).
 *   2. beforeLint hook (e.g. CLI renders the project-detection block)
 *   3. environment checks (reduced-motion + pnpm hardening +
 *      expo/react-native), collected synchronously. The heavier
 *      content-regex security scan is forked instead (like supply-chain
 *      below) and joined before the concat, so its CPU overlaps lint
 *      rather than blocking the event loop before it.
 *   4. The supply-chain check (Socket.dev) is forked onto a background
 *      fiber so its ~100% network-bound time overlaps the ~100%
 *      CPU/subprocess-bound lint pass below, collapsing two serial
 *      phases into roughly `max(supplyChain, lint)`. It is capped by
 *      `SupplyChainOverlapTimeoutMs` (measured from fork) so a hung
 *      socket can't drag out its join; on timeout it fails open to no
 *      diagnostics — the same outcome class as a Socket outage.
 *   5. Linter.run runs; DeadCode.run runs concurrently (forked child
 *      fiber) ONLY when the memory gate has headroom to run the 8 GB
 *      dead-code child alongside the oxlint workers — or when overlap is
 *      forced via REACT_DOCTOR_DEAD_CODE_OVERLAP. Otherwise dead-code
 *      runs sequentially after lint, exactly as it did pre-overlap. The
 *      fiber is joined (or interrupted, SIGKILLing its worker, on lint
 *      failure) before diagnostics are concatenated. The afterLint hook
 *      fires between lint and dead-code. Progress spinner labels AND the
 *      final diagnostic / score order stay independent of execution
 *      order, so terminal output is identical either way; supply-chain
 *      rides alongside without a spinner.
 *   6. Join the supply-chain fiber, then assemble the diagnostics in a
 *      FIXED order (env, security-scan, supply-chain, lint, dead-code) so the output is
 *      byte-identical regardless of which fiber settled first. The
 *      viewer-permission fiber is joined later, during score-metadata
 *      assembly (it feeds score metadata, not diagnostics). The per-element
 *      `Reporter.emit` side-channel now interleaves supply-chain with lint
 *      emits, so capture-order assertions must target the deterministic
 *      concat below, not emit order (production `Reporter.layerNoop` makes
 *      emit a no-op).
 *   7. Reporter.finalize
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
  | SupplyChain
  | ProjectChecks
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
    const supplyChainService = yield* SupplyChain;
    const gitService = yield* Git;
    const progressService = yield* Progress;
    const projectChecksService = yield* ProjectChecks;
    const partialFailuresRef = yield* LintPartialFailures;

    const resolvedConfig: ResolvedConfig = yield* configService.resolve(input.directory);
    const scanDirectory = resolvedConfig.resolvedDirectory;

    const project = yield* projectService.discover(scanDirectory);
    if (!isAnalyzableProject(project)) {
      return yield* new ReactDoctorError({
        reason: new NoReactDependency({ directory: scanDirectory }),
      });
    }
    const scoreMetadataExecution = yield* startScoreMetadataExecution({
      gitService,
      directory: scanDirectory,
      project,
      isCi: input.isCi,
      shouldResolveLocalGithubViewerPermission: input.resolveLocalGithubViewerPermission === true,
      doctorVersion: input.doctorVersion,
      runId: input.runId,
    });

    const scanSettings = resolveInspectScanSettings({
      input,
      rootDirectory: scanDirectory,
      userConfig: resolvedConfig.config,
    });
    const { lintIncludePaths, isDiffMode, showWarnings, shouldRunSupplyChain } = scanSettings;

    // Absolute paths of the exact file set the linter scans, captured ONLY
    // for the multi-project summary (the sole consumer), which signals via
    // `suppressScanSummary`. Gating avoids a redundant full-tree walk on
    // every single-project / `diagnose()` run — for a full scan the linter
    // already enumerates the same files, so we'd otherwise list twice.
    const fallbackScannedFilePaths = scanSettings.shouldCollectFallbackScannedFilePaths
      ? (lintIncludePaths ?? (yield* filesService.listSourceFiles(scanDirectory))).map(
          (relativePath) => path.resolve(scanDirectory, relativePath),
        )
      : [];

    const beforeLint = hooks.beforeLint ?? NO_HOOKS.beforeLint;
    const afterLint = hooks.afterLint ?? NO_HOOKS.afterLint;
    yield* beforeLint(project, lintIncludePaths ?? undefined);

    const transform = buildDiagnosticPipeline({
      rootDirectory: scanDirectory,
      userConfig: resolvedConfig.config,
      readFileLinesSync: fileReader(filesService, scanDirectory),
      respectInlineDisables: input.respectInlineDisables,
      showWarnings,
    });

    const filterPerElementPipeline = <ToEnv>(rawStream: Stream.Stream<Diagnostic, never, ToEnv>) =>
      rawStream.pipe(Stream.filterMap(filterMapNullable<Diagnostic, Diagnostic>(transform.apply)));

    const applyPerElementPipeline = <ToEnv>(rawStream: Stream.Stream<Diagnostic, never, ToEnv>) =>
      filterPerElementPipeline(rawStream).pipe(
        Stream.tap((diagnostic) => reporterService.emit(diagnostic)),
      );

    const backgroundAnalyzerExecution = yield* startBackgroundAnalyzerExecution({
      projectChecksService,
      supplyChainService,
      rootDirectory: scanDirectory,
      project,
      userConfig: resolvedConfig.config,
      isDiffMode,
      shouldRunSupplyChain,
      ignoredTags: input.ignoredTags,
      includedTags: input.includedTags,
      includeTagDefaults: input.includeTagDefaults,
      processDiagnostics: applyPerElementPipeline,
    });

    const lintFailure = yield* Ref.make<LintFailureState>({
      didFail: false,
      reason: null,
      reasonTag: null,
      reasonKind: null,
    });
    const deadCodeFailure = yield* Ref.make<DeadCodeFailureState>({
      didFail: false,
      reason: null,
    });

    // The actual worker count: clamp the Reference through the same
    // spawn-boundary clamp the Linter applies, so the spinner suffix and the
    // `scanConcurrency` we surface for telemetry both reflect the real fan-out
    // (a programmatic `inspect({ concurrency })` override reaches the Reference
    // unclamped). Defaults to the memory-and-core-budgeted auto count.
    const scanConcurrency = resolveScanConcurrency(yield* OxlintConcurrency);
    const lintPhaseTimeoutMs = yield* LintPhaseTimeoutMs;
    const deadCodePhaseTimeoutMs = yield* DeadCodePhaseTimeoutMs;
    const workerCountSuffix =
      scanConcurrency > 1 ? ` ${highlighter.dim(`[~${scanConcurrency} workers]`)}` : "";

    // ── Dead-code plan ────────────────────────────────────────────────
    // Dead-code (deslop reachability) emits only `"warning"`-severity
    // diagnostics, all `Maintainability`; warnings show by default, so this
    // normally runs. Only `--no-warnings` / `warnings: false` filters its output
    // out entirely before any surface or the score, making the expensive pass
    // pure wasted work — so skip it then, unless a severity override restamps
    // dead-code findings so they survive the global hide.
    // Dead-code runs SEQUENTIALLY (after lint, with the full core budget) by
    // default. deslop's parse pass is CPU-bound, so overlapping it with the
    // equally CPU-bound oxlint pool can't shrink wall-clock — there are no spare
    // cores to absorb it — and only risks oversubscription: both pools size to
    // all cores, so concurrently they demand ~2x the cores, thrash, and the
    // parse pass misses its timeout and silently drops EVERY dead-code finding
    // (observed: ~all 349 findings dropped on supply-chain-on Sentry scans).
    // Sequential gives deslop the full cores (fastest per-phase) and never
    // contends. `DeadCodeOverlap="on"` still forces the overlap for operators
    // who want it; then the two pools SPLIT the budget — deslop's parse pool is
    // capped (`parseConcurrency`) and lint shrinks to the remainder — so they
    // sum to the cores instead of doubling them.
    const deadCodeOverlapMode = yield* DeadCodeOverlap;
    const deadCodePlan = buildDeadCodePlan({
      runDeadCode: input.runDeadCode,
      isDiffMode,
      showWarnings,
      userConfig: resolvedConfig.config,
      overlapMode: deadCodeOverlapMode,
      scanConcurrency,
    });

    const deadCodeExecution = yield* startDeadCodeExecution({
      deadCodeService,
      failureRef: deadCodeFailure,
      plan: deadCodePlan,
      rootDirectory: scanDirectory,
      discoveredSourceFileCount: project.sourceFileCount,
      scanConcurrency,
      configuredPhaseTimeoutMs: deadCodePhaseTimeoutMs,
      deadlineEpochMs: input.deadlineEpochMs,
      processDiagnostics: applyPerElementPipeline,
    });

    const scanProgress = yield* progressService.start("Scanning...");
    const scanStartTime = Date.now();
    const lintExecution = buildLintExecution({
      rootDirectory: scanDirectory,
      project,
      includePaths: lintIncludePaths,
      options: input,
      resolvedConfig,
      reportFileProgress: (scannedFileCount, totalFileCount) => {
        Effect.runSync(
          scanProgress.update(
            `Scanning files (${scannedFileCount}/${totalFileCount})${workerCountSuffix}...`,
          ),
        );
      },
    });

    const lintResult = yield* runLintPhase({
      linterService,
      lintInput: lintExecution.input,
      failureRef: lintFailure,
      shouldOverrideLintConcurrency: deadCodePlan.shouldOverlap,
      lintConcurrency: deadCodePlan.lintConcurrency,
      phaseTimeoutMs: lintPhaseTimeoutMs,
      filterDiagnostics: filterPerElementPipeline,
      reporterService,
      afterLint,
      progress: scanProgress,
      nodeVersion: process.version,
    });
    const lintCollected = lintResult.diagnostics;
    const lintFailureState = lintResult.failure;

    // ora throttles renders to its frame interval, so the final `(N, N)`
    // progress frame the linter emits on its last batch is overwritten by the
    // next phase's text before it ever paints — the live counter looks frozen
    // short of N even though every file was scanned (issue #815). Resolve the
    // full total now and carry it into the dead-code label so "scanned N files"
    // stays visible for the whole (longer) dead-code pass.
    const {
      analyzedFiles,
      scannedFileCount: totalFileCount,
      scannedFilePaths,
    } = resolveScanFileCoverage({
      rootDirectory: scanDirectory,
      lintFileCoverage: lintExecution.state.fileCoverage,
      lastReportedTotalFileCount: lintExecution.state.lastReportedTotalFileCount,
      lintIncludePathCount: lintIncludePaths?.length ?? null,
      discoveredSourceFileCount: project.sourceFileCount,
      includeScannedFilePaths: input.suppressScanSummary === true,
      fallbackScannedFilePaths,
    });
    const scannedFilesLabel = `${totalFileCount} ${totalFileCount === 1 ? "file" : "files"}`;

    const deadCodeResult = yield* deadCodeExecution.settle({
      lintDidFail: lintFailureState.didFail,
      totalFileCount,
      scannedFilesLabel,
      progress: scanProgress,
    });
    const scanElapsedMilliseconds = Date.now() - scanStartTime;
    const scanCompletion = resolveScanCompletion({
      lintDidFail: lintFailureState.didFail,
      deadCodeFailure: deadCodeResult.failure,
      suppressScanSummary: Boolean(input.suppressScanSummary),
      scannedFilesLabel,
      scanElapsedMilliseconds,
      workerCountSuffix,
    });
    const deadCodeFailureState = scanCompletion.deadCodeFailure;

    if (scanCompletion.progress.action === "fail" && scanCompletion.progress.text !== null) {
      yield* scanProgress.fail(scanCompletion.progress.text);
    } else if (scanCompletion.progress.action === "stop") {
      yield* scanProgress.stop();
    } else if (
      scanCompletion.progress.action === "succeed" &&
      scanCompletion.progress.text !== null
    ) {
      yield* scanProgress.succeed(scanCompletion.progress.text);
    }

    const backgroundAnalyzerResult = yield* backgroundAnalyzerExecution.join;

    yield* reporterService.finalize;

    const { diagnostics: finalDiagnostics, scoreDiagnostics } = finalizeDiagnosticOutput({
      environmentDiagnostics: backgroundAnalyzerResult.environmentDiagnostics,
      securityDiagnostics: backgroundAnalyzerResult.securityDiagnostics,
      supplyChainDiagnostics: backgroundAnalyzerResult.supplyChainDiagnostics,
      lintDiagnostics: lintCollected,
      deadCodeDiagnostics: deadCodeResult.diagnostics,
      scoreSurface: input.scoreSurface ?? "score",
      userConfig: resolvedConfig.config,
    });

    const scoreMetadata = yield* scoreMetadataExecution.join;

    // Dead-code findings feed the scored set, so a failed or deadline-skipped
    // dead-code pass would leave the score computed over an incomplete set —
    // overstating health. Null it like a lint failure; a pass that was merely
    // disabled never sets `didFail`, so `--no-deslop` scans keep their score.
    const score = scanCompletion.shouldComputeScore
      ? yield* scoreService.compute({
          diagnostics: scoreDiagnostics,
          isCi: input.isCi,
          metadata: scoreMetadata,
        })
      : null;
    const lintPartialFailures = yield* Ref.get(partialFailuresRef);

    return assembleInspectOutput({
      project,
      userConfig: resolvedConfig.config,
      resolvedDirectory: scanDirectory,
      diagnostics: finalDiagnostics,
      score,
      scoreMetadata,
      lint: {
        didFail: lintFailureState.didFail,
        failureReason: lintFailureState.reason,
        failureReasonTag: lintFailureState.reasonTag,
        failureReasonKind: lintFailureState.reasonKind,
        partialFailures: lintPartialFailures,
        analyzedFiles,
        cacheHitFileCount: lintExecution.state.cacheHitFileCount,
        cacheTotalFileCount: lintExecution.state.cacheTotalFileCount,
        sidecarReplayedFileCount: lintExecution.state.sidecarReplayedFileCount,
        sidecarTotalFileCount: lintExecution.state.sidecarTotalFileCount,
      },
      deadCode: {
        didFail: deadCodeFailureState.didFail,
        failureReason: deadCodeFailureState.reason,
        didOverlap: deadCodePlan.shouldOverlap,
        cacheHit: deadCodeResult.cacheHit,
        summaryCacheHits: deadCodeResult.summaryCacheHits,
        summaryCacheMisses: deadCodeResult.summaryCacheMisses,
      },
      scan: {
        scannedFileCount: totalFileCount,
        scannedFilePaths,
        elapsedMilliseconds: scanElapsedMilliseconds,
        concurrency: scanConcurrency,
      },
      supplyChainOverlapTimedOut: backgroundAnalyzerResult.supplyChainOverlapTimedOut,
      securityScanFailed: backgroundAnalyzerResult.securityScanFailed,
      suppressedRuleCounts: transform.summarizeSuppressions(),
    });
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
    // Overall scan deadline backstop: bounds any phase not individually
    // capped (e.g. a wedged git/IO call). Raises `ScanDeadlineExceeded`,
    // keeping the declared error channel as `ReactDoctorError`; the CLI's
    // `restoreLegacyThrow` re-dies it cleanly into `handleError`.
    (scanProgram) =>
      Effect.flatMap(ScanDeadlineMs, (scanDeadlineMs) =>
        scanProgram.pipe(
          Effect.timeout(scanDeadlineMs),
          Effect.catchTag(
            "TimeoutError",
            () =>
              new ReactDoctorError({
                reason: new ScanDeadlineExceeded({
                  detail: `${scanDeadlineMs / MILLISECONDS_PER_SECOND}s elapsed`,
                }),
              }),
          ),
        ),
      ),
  );
