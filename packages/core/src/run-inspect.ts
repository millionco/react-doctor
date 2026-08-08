import * as path from "node:path";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Filter from "effect/Filter";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";
import type { Diagnostic, DiagnosticSurface } from "./types/index.js";
import { assignFixGroups } from "./utils/assign-fix-groups.js";
import { dedupeRelatedDiagnostics } from "./utils/dedupe-related-diagnostics.js";
import { isPathInsideDirectory } from "./utils/is-path-inside-directory.js";
import { scrubSensitivePaths } from "./utils/scrub-sensitive-paths.js";
import { sortDiagnosticsStable } from "./utils/sort-diagnostics-stable.js";
import { buildDiagnosticPipeline } from "./build-diagnostic-pipeline.js";
import { checkExpoProject } from "./check-expo-project.js";
import { checkPnpmHardening } from "./check-pnpm-hardening.js";
import { checkReactNativeProject } from "./check-react-native-project.js";
import { checkReactServerComponentsAdvisory } from "./check-react-server-components-advisory.js";
import { checkReducedMotion } from "./check-reduced-motion.js";
import { checkSecurityScanCooperative } from "./check-security-scan.js";
import {
  DEAD_CODE_OVERLAP_PARSE_SHARE,
  DEFAULT_SHOW_WARNINGS,
  MILLISECONDS_PER_SECOND,
  MIN_DEAD_CODE_PARSE_CONCURRENCY,
  MIN_SCAN_CONCURRENCY,
} from "./constants.js";
import { highlighter } from "./highlighter.js";
import { computeExplicitLintIncludePaths } from "./explicit-lint-include-paths.js";
import { deadCodeMaySurfaceWhenWarningsHidden } from "./utils/dead-code-may-surface.js";
import {
  NoReactDependency,
  type OxlintUnavailable,
  ReactDoctorError,
  type ReactDoctorErrorReason,
  ScanDeadlineExceeded,
} from "./errors.js";
import { filterDiagnosticsForSurface } from "./filter-for-surface.js";
import { isAnalyzableProject } from "./project-info/index.js";
import {
  DeadCodeOverlap,
  DeadCodePhaseTimeoutMs,
  LintPhaseTimeoutMs,
  OxlintConcurrency,
  ScanDeadlineMs,
  SupplyChainOverlapTimeoutMs,
} from "./refs.js";
import { remainingDeadlineBudgetMs } from "./utils/remaining-deadline-budget-ms.js";
import { resolveDeadCodeTimeout } from "./utils/resolve-dead-code-timeout.js";
import { resolveLintIncludePaths } from "./resolve-lint-include-paths.js";
import { filterPathsOutsideDirectories } from "./utils/filter-paths-outside-directories.js";
import { Config, type ResolvedConfig } from "./services/config.js";
import { DeadCode } from "./services/dead-code.js";
import { Files } from "./services/files.js";
import { Git } from "./services/git.js";
import { type LintFileCoverage, LintPartialFailures, Linter } from "./services/linter.js";
import { Progress } from "./services/progress.js";
import { Project } from "./services/project.js";
import { Reporter } from "./services/reporter.js";
import { Score } from "./services/score.js";
import { SupplyChain } from "./services/supply-chain.js";
import type { ScoreRequestMetadata } from "./calculate-score.js";
import { resolveGithubActionsScoreMetadata } from "./utils/resolve-github-actions-score-metadata.js";
import { resolveScanConcurrency } from "./utils/resolve-scan-concurrency.js";
import { toNormalizedRelativePath } from "./utils/to-normalized-relative-path.js";

export type { InspectHooks, InspectInput, InspectOutput } from "./types/run-inspect.js";
import type { InspectHooks, InspectInput, InspectOutput } from "./types/run-inspect.js";

/**
 * The settled result of the background supply-chain fiber: its collected
 * diagnostics, plus whether the fork-relative overlap timeout fired (in which
 * case `diagnostics` is empty — the fail-open outcome).
 */
interface SupplyChainForkResult {
  readonly diagnostics: ReadonlyArray<Diagnostic>;
  readonly timedOut: boolean;
}

const NO_HOOKS: Required<InspectHooks<never>> = {
  beforeLint: () => Effect.void,
  afterLint: () => Effect.void,
};

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
 *   1. Config.resolve(directory) → Project.discover → Git metadata.
 *      The GitHub viewer-permission lookup is forked onto a background
 *      fiber here and joined late (it feeds score metadata, not
 *      diagnostics).
 *   2. beforeLint hook (e.g. CLI records project telemetry)
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
 *   5. Linter.run runs; DeadCode.run forks only when
 *      REACT_DOCTOR_DEAD_CODE_OVERLAP=on. The default "auto" and explicit
 *      "off" paths stay sequential. The fiber is joined (or interrupted,
 *      SIGKILLing its worker, on lint failure) before diagnostics are
 *      concatenated. The afterLint hook
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
    const partialFailuresRef = yield* LintPartialFailures;

    const resolvedConfig: ResolvedConfig = yield* configService.resolve(input.directory);
    const scanDirectory = resolvedConfig.resolvedDirectory;
    const excludedProjectDirectories = (input.excludedProjectDirectories ?? [])
      .map((excludedDirectory) => path.resolve(excludedDirectory))
      .filter((excludedDirectory) => isPathInsideDirectory(excludedDirectory, scanDirectory));
    const excludedProjectRelativePaths = excludedProjectDirectories.map((excludedDirectory) =>
      path.relative(scanDirectory, excludedDirectory).replaceAll("\\", "/"),
    );
    const isExcludedProjectDiagnostic = (diagnostic: Diagnostic): boolean => {
      const relativeFilePath = toNormalizedRelativePath(diagnostic.filePath, scanDirectory);
      return excludedProjectRelativePaths.some(
        (excludedRelativePath) =>
          relativeFilePath === excludedRelativePath ||
          relativeFilePath.startsWith(`${excludedRelativePath}/`),
      );
    };
    const shouldPrecomputeSourceFiles =
      input.suppressScanSummary === true || excludedProjectDirectories.length > 0;
    const precomputedSourceFiles = shouldPrecomputeSourceFiles
      ? yield* filesService.listSourceFilesCooperative({
          rootDirectory: scanDirectory,
          signal: input.signal,
        })
      : null;
    const includedPrecomputedSourceFiles =
      precomputedSourceFiles !== null && excludedProjectDirectories.length > 0
        ? filterPathsOutsideDirectories({
            rootDirectory: scanDirectory,
            relativePaths: precomputedSourceFiles,
            excludedDirectories: excludedProjectDirectories,
          })
        : precomputedSourceFiles;
    const sourceFileCount =
      excludedProjectDirectories.length > 0
        ? includedPrecomputedSourceFiles?.length
        : (input.precomputedSourceFileCount ?? includedPrecomputedSourceFiles?.length);
    const project = yield* projectService.discover({
      directory: scanDirectory,
      sourceFileCount,
    });
    if (!isAnalyzableProject(project)) {
      return yield* new ReactDoctorError({
        reason: new NoReactDependency({ directory: scanDirectory }),
      });
    }
    const deadCodeSourceFileCount =
      input.retainExcludedProjectDeadCodeDiagnostics === true && precomputedSourceFiles !== null
        ? precomputedSourceFiles.length
        : project.sourceFileCount;
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

    const explicitLintIncludePaths = input.skipExplicitIncludePathFilter
      ? input.includePaths.length > 0
        ? [...input.includePaths]
        : undefined
      : computeExplicitLintIncludePaths([...input.includePaths]);
    let lintIncludePaths =
      explicitLintIncludePaths ??
      resolveLintIncludePaths(
        scanDirectory,
        resolvedConfig.config,
        includedPrecomputedSourceFiles ?? undefined,
      );
    if (excludedProjectDirectories.length > 0) {
      const candidatePaths =
        lintIncludePaths ??
        includedPrecomputedSourceFiles ??
        (yield* filesService.listSourceFiles(scanDirectory));
      lintIncludePaths = filterPathsOutsideDirectories({
        rootDirectory: scanDirectory,
        relativePaths: candidatePaths,
        excludedDirectories: excludedProjectDirectories,
      });
    }

    // Absolute paths of the exact file set the linter scans, captured ONLY
    // for the multi-project summary (the sole consumer), which signals via
    // `suppressScanSummary`. Gating avoids a redundant full-tree walk on
    // every single-project / `diagnose()` run — for a full scan the linter
    // already enumerates the same files, so we'd otherwise list twice.
    const fallbackScannedFilePaths = input.suppressScanSummary
      ? (
          lintIncludePaths ??
          includedPrecomputedSourceFiles ??
          (yield* filesService.listSourceFiles(scanDirectory))
        ).map((relativePath) => path.resolve(scanDirectory, relativePath))
      : [];

    const beforeLint = hooks.beforeLint ?? NO_HOOKS.beforeLint;
    const afterLint = hooks.afterLint ?? NO_HOOKS.afterLint;
    yield* beforeLint(project);

    const isDiffMode = input.includePaths.length > 0;

    const showWarnings = input.warnings ?? resolvedConfig.config?.warnings ?? DEFAULT_SHOW_WARNINGS;

    const transform = buildDiagnosticPipeline({
      rootDirectory: scanDirectory,
      userConfig: resolvedConfig.config,
      readFileLinesSync: fileReader(filesService, scanDirectory),
      respectInlineDisables: input.respectInlineDisables,
      showWarnings,
    });

    const filterPerElementPipeline = <ToEnv>(rawStream: Stream.Stream<Diagnostic, never, ToEnv>) =>
      rawStream.pipe(
        Stream.filterMap(
          Filter.fromPredicateOption((diagnostic: Diagnostic) => {
            const filteredDiagnostic = transform.apply(diagnostic);
            return filteredDiagnostic === null ? Option.none() : Option.some(filteredDiagnostic);
          }),
        ),
      );

    const applyPerElementPipeline = <ToEnv>(rawStream: Stream.Stream<Diagnostic, never, ToEnv>) =>
      filterPerElementPipeline(rawStream).pipe(
        Stream.tap((diagnostic) => reporterService.emit(diagnostic)),
      );

    // ── Phase: environment checks ──────────────────────────────────
    // The project-shape checks below are sub-millisecond; the security scan
    // (whole-tree content pass) is heavy and forks separately just below.
    const environmentDiagnostics: ReadonlyArray<Diagnostic> = isDiffMode
      ? []
      : [
          ...checkReducedMotion(scanDirectory),
          ...checkPnpmHardening(scanDirectory),
          ...checkReactServerComponentsAdvisory(scanDirectory, project),
          ...checkExpoProject(scanDirectory, project),
          ...checkReactNativeProject(scanDirectory, project),
        ];
    const envCollected = yield* Stream.runCollect(
      applyPerElementPipeline(Stream.fromIterable(environmentDiagnostics)),
    );

    // ── Phase: security scan (content-regex over the whole tree) ───
    // Registry rules carrying a `scan` run here, not via oxlint — over shipped
    // artifacts / dotenv / SQL that lint never parses. It's the heaviest CPU
    // phase on real repos (~O(rules × files × content)) and previously ran
    // SYNCHRONOUSLY before lint, blocking the event loop the whole time. Fork it
    // here (before lint) and join it just before the concat so its main-thread
    // CPU overlaps the subprocess-bound lint pass; `checkSecurityScanCooperative`
    // hands the event loop back on a per-slice time budget so it can't starve
    // lint's subprocess spawning/draining or sibling projects. Skipped in
    // diff/staged mode like the env checks. The final stable sort makes the
    // concat order irrelevant, so output stays byte-identical to the serial path.
    const securityScanFailedRef = yield* Ref.make(false);
    let didSecurityScanReachDeadline = false;
    const securityScanFiber = yield* Effect.forkChild(
      Stream.runCollect(
        applyPerElementPipeline(
          isDiffMode
            ? (Stream.empty as Stream.Stream<Diagnostic, never>)
            : Stream.unwrap(
                // Fail-open like every other analyzer: a non-ignorable fs
                // error escaping the cooperative walk (fd exhaustion under
                // concurrent oxlint workers, EIO) must skip the pass, not
                // defect through the unconditional `Fiber.join` and sink an
                // otherwise-successful scan. The skip is recorded on
                // `securityScanFailed` so telemetry can tell a failed pass
                // from a clean one — mirroring `supplyChainOverlapTimedOut`.
                Effect.tryPromise((signal) =>
                  checkSecurityScanCooperative(scanDirectory, {
                    project,
                    ignoredTags: input.ignoredTags,
                    includedTags: input.includedTags,
                    includeTagDefaults: input.includeTagDefaults,
                    excludedDirectories: new Set(excludedProjectDirectories),
                    deadlineEpochMs: input.deadlineEpochMs,
                    signal,
                    onDeadlineExceeded: () => {
                      didSecurityScanReachDeadline = true;
                    },
                  }),
                ).pipe(
                  Effect.map((diagnostics) => Stream.fromIterable(diagnostics)),
                  Effect.catch(() =>
                    Ref.set(securityScanFailedRef, true).pipe(
                      Effect.as(Stream.empty as Stream.Stream<Diagnostic, never>),
                    ),
                  ),
                ),
              ),
        ),
      ).pipe(Effect.withSpan("SecurityScan.run")),
    );

    // ── Phase: supply-chain score check (Socket.dev, opt-in) ───────
    // Whole-project (package.json) property, so a plain diff/staged scan
    // skips it like the environment checks above — but a diff that edits
    // the scanned project's `package.json` (e.g. a PR adding/bumping a
    // dependency) still runs it via `supplyChainManifestChanged`, so the
    // change is scored where it matters. Enablement is decided by the
    // provided layer (`SupplyChain.layerOf([])` when disabled). The stream
    // is fail-open — per-package timeouts / network failures are recovered
    // to "skip" inside the check — so a Socket API outage never sinks the scan.
    //
    // The check is ~100% network-bound and the lint pass below is ~100%
    // CPU/subprocess-bound, so we fork it onto a child fiber here and join it
    // just before the diagnostic concat — its wall-clock overlaps lint instead
    // of running serially before it. `forkChild` is structured: any
    // error/interrupt in the orchestrator tears this fiber down with it, so it
    // never leaks. The collect can't fail (the stream has no error channel), so
    // the only failure is the `Effect.timeout` deadline, which we fold into a
    // fail-open `[]` + a `timedOut` marker — the same outcome class as a Socket
    // outage. The deadline is measured FROM FORK (before lint), so it bounds a
    // hung undici socket without depending on how long lint takes. (On the rare
    // timeout, a stateful reporter may hold supply-chain emits from before the
    // deadline that the returned `[]` omits; production `Reporter.layerNoop`
    // makes emit a no-op, and the returned diagnostics/score only read the
    // joined value.)
    // When skipped, the fork takes the empty branch so the join below stays
    // unconditional (mirroring the viewer-permission fiber above).
    const capToDeadline = (phaseTimeoutMs: number): number =>
      input.deadlineEpochMs === undefined
        ? phaseTimeoutMs
        : Math.min(phaseTimeoutMs, remainingDeadlineBudgetMs(input.deadlineEpochMs));
    const capOptionalToDeadline = (phaseTimeoutMs: number | null): number | null => {
      if (input.deadlineEpochMs === undefined) return phaseTimeoutMs;
      const remainingBudgetMs = remainingDeadlineBudgetMs(input.deadlineEpochMs);
      return phaseTimeoutMs === null
        ? remainingBudgetMs
        : Math.min(phaseTimeoutMs, remainingBudgetMs);
    };
    const shouldRunSupplyChain = !isDiffMode || (input.supplyChainManifestChanged ?? false);
    const supplyChainOverlapTimeout = capToDeadline(yield* SupplyChainOverlapTimeoutMs);
    const supplyChainFiber = yield* Effect.forkChild(
      shouldRunSupplyChain
        ? Stream.runCollect(
            applyPerElementPipeline(
              supplyChainService.run({
                rootDirectory: scanDirectory,
                userConfig: resolvedConfig.config,
                timeoutMs: supplyChainOverlapTimeout,
              }),
            ),
          ).pipe(
            Effect.map(
              (diagnostics): SupplyChainForkResult => ({
                diagnostics,
                timedOut: false,
              }),
            ),
            Effect.timeout(supplyChainOverlapTimeout),
            Effect.orElseSucceed(
              (): SupplyChainForkResult => ({ diagnostics: [], timedOut: true }),
            ),
          )
        : Effect.succeed<SupplyChainForkResult>({
            diagnostics: [],
            timedOut: false,
          }),
    );

    const lintFailure = yield* Ref.make<{
      didFail: boolean;
      reason: string | null;
      reasonTag: ReactDoctorErrorReason["_tag"] | null;
      reasonKind: OxlintUnavailable["kind"] | null;
    }>({ didFail: false, reason: null, reasonTag: null, reasonKind: null });
    const deadCodeFailure = yield* Ref.make<{
      didFail: boolean;
      reason: string | null;
    }>({
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
    const shouldRunDeadCode =
      input.runDeadCode &&
      !isDiffMode &&
      (showWarnings || deadCodeMaySurfaceWhenWarningsHidden(resolvedConfig.config));
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
    const shouldOverlapDeadCode = shouldRunDeadCode && deadCodeOverlapMode === "on";
    const deadCodeParseConcurrency = shouldOverlapDeadCode
      ? Math.max(
          MIN_DEAD_CODE_PARSE_CONCURRENCY,
          Math.floor(scanConcurrency * DEAD_CODE_OVERLAP_PARSE_SHARE),
        )
      : undefined;
    const lintConcurrency =
      deadCodeParseConcurrency === undefined
        ? scanConcurrency
        : Math.max(MIN_SCAN_CONCURRENCY, scanConcurrency - deadCodeParseConcurrency);
    let deadCodeCacheHit: boolean | null = null;
    let deadCodeSummaryCacheHits: number | null = null;
    let deadCodeSummaryCacheMisses: number | null = null;

    // Runs either forked (overlap) or inline (sequential) with the same pipeline
    // + failure Ref. Building this is side-effect-free; the worker spawns only
    // when the effect runs.
    const buildCollectDeadCode = (deadCodeTimeout: {
      workerTimeoutMs: number;
      phaseTimeoutMs: number | null;
    }) => {
      const collectDeadCode = Stream.runCollect(
        applyPerElementPipeline(
          deadCodeService
            .run({
              rootDirectory: scanDirectory,
              parseConcurrency: deadCodeParseConcurrency,
              workerTimeoutMs: deadCodeTimeout.workerTimeoutMs,
              onCacheOutcome: (didHitCache) => {
                deadCodeCacheHit = didHitCache;
              },
              onSummaryCacheStats: (stats) => {
                deadCodeSummaryCacheHits = stats.hits;
                deadCodeSummaryCacheMisses = stats.misses;
              },
            })
            .pipe(
              Stream.filter(
                (diagnostic) =>
                  input.retainExcludedProjectDeadCodeDiagnostics === true ||
                  !isExcludedProjectDiagnostic(diagnostic),
              ),
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
      );
      const phaseTimeoutMs = deadCodeTimeout.phaseTimeoutMs;
      if (phaseTimeoutMs === null) return collectDeadCode;
      return collectDeadCode.pipe(
        Effect.timeoutOption(phaseTimeoutMs),
        Effect.flatMap(
          Option.match({
            onNone: () =>
              Ref.set(deadCodeFailure, {
                didFail: true,
                reason: `Dead-code analysis exceeded ${Math.round(
                  phaseTimeoutMs / MILLISECONDS_PER_SECOND,
                )}s and was skipped.`,
              }).pipe(Effect.as<Diagnostic[]>([])),
            onSome: Effect.succeed,
          }),
        ),
      );
    };
    // The overlap fork happens BEFORE lint, so the lint-reported file count isn't
    // known yet — scale the timeout off the project's discovered source count and
    // the reduced core share. (`forkChild`, not `startImmediately`: the lint
    // `Stream.runCollect` below blocks the parent on async oxlint spawns, yielding
    // the runtime to this child so it runs DURING lint. Auto-supervised —
    // interrupted if the parent dies.)
    const overlapDeadCodeTimeout = resolveDeadCodeTimeout({
      sourceFileCount: deadCodeSourceFileCount,
      deadCodeConcurrency: deadCodeParseConcurrency ?? scanConcurrency,
      fullConcurrency: scanConcurrency,
    });
    const deadCodeFiber = shouldOverlapDeadCode
      ? yield* Effect.forkChild(
          buildCollectDeadCode({
            workerTimeoutMs: overlapDeadCodeTimeout.workerTimeoutMs,
            phaseTimeoutMs: capOptionalToDeadline(deadCodePhaseTimeoutMs),
          }),
        )
      : null;

    const scanProgress = yield* progressService.start("Scanning...");
    const scanStartTime = Date.now();
    let lastReportedTotalFileCount = 0;
    // `null` until the cache path reports — stays `null` when the cache is off
    // or bypassed so the wide event can tell "no cache" from "0% hit".
    let lintCacheHitFileCount: number | null = null;
    let lintCacheTotalFileCount: number | null = null;
    let lintSidecarReplayedFileCount: number | null = null;
    let lintSidecarTotalFileCount: number | null = null;
    const lintFileCoverageState: { value: LintFileCoverage | null } = { value: null };

    const baseLintStream = linterService
      .run({
        rootDirectory: scanDirectory,
        project,
        includePaths: lintIncludePaths ?? undefined,
        nodeBinaryPath: input.nodeBinaryPath,
        customRulesOnly: input.customRulesOnly,
        respectInlineDisables: input.respectInlineDisables,
        adoptExistingLintConfig: input.adoptExistingLintConfig,
        ignoredTags: input.ignoredTags,
        includedTags: input.includedTags,
        includeTagDefaults: input.includeTagDefaults,
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
        onFileCoverage: (coverage) => {
          lintFileCoverageState.value = coverage;
        },
        onCacheStats: (cacheHitFileCount, totalConsideredFileCount) => {
          lintCacheHitFileCount = cacheHitFileCount;
          lintCacheTotalFileCount = totalConsideredFileCount;
        },
        onSidecarStats: (sidecarReplayedFileCount, sidecarConsideredFileCount) => {
          lintSidecarReplayedFileCount = sidecarReplayedFileCount;
          lintSidecarTotalFileCount = sidecarConsideredFileCount;
        },
        deadlineEpochMs: input.deadlineEpochMs,
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
    // When dead-code is overlapped (opt-in `DeadCodeOverlap="on"`), lint runs on
    // the reduced share of the core budget so the two CPU-bound pools sum to the
    // cores instead of oversubscribing. The default (sequential) path leaves lint
    // untouched at the full budget.
    const rawLintStream = shouldOverlapDeadCode
      ? baseLintStream.pipe(Stream.provideService(OxlintConcurrency, lintConcurrency))
      : baseLintStream;

    // Lint phase cap (Effect-side, runtime-independent of the per-batch
    // spawn timeout and the bounded split cascade): on timeout, fold into
    // the existing lint-failure contract (score becomes null) with an
    // `OxlintBatchExceeded`-tagged reason so renderers dispatch on it, and
    // yield an empty chunk so the rest of the scan still completes.
    const collectLintDiagnostics = Stream.runCollect(filterPerElementPipeline(rawLintStream));
    const filteredLintDiagnostics = yield* lintPhaseTimeoutMs === null
      ? collectLintDiagnostics
      : collectLintDiagnostics.pipe(
          Effect.timeoutOption(lintPhaseTimeoutMs),
          Effect.flatMap(
            Option.match({
              onNone: () =>
                Ref.set(lintFailure, {
                  didFail: true,
                  reason: `Lint analysis exceeded ${
                    lintPhaseTimeoutMs / MILLISECONDS_PER_SECOND
                  }s and was skipped.`,
                  reasonTag: "OxlintBatchExceeded",
                  reasonKind: null,
                }).pipe(Effect.as<Diagnostic[]>([])),
              onSome: Effect.succeed,
            }),
          ),
        );
    const lintCollected = dedupeRelatedDiagnostics(filteredLintDiagnostics);
    yield* Effect.forEach(lintCollected, reporterService.emit, { discard: true });
    const lintFailureState = yield* Ref.get(lintFailure);
    yield* afterLint(lintFailureState.didFail);

    if (lintFailureState.didFail) {
      yield* scanProgress.fail(formatLintFailText(lintFailureState.reasonTag, process.version));
    }

    // ora throttles renders to its frame interval, so the final `(N, N)`
    // progress frame the linter emits on its last batch is overwritten by the
    // next phase's text before it ever paints — the live counter looks frozen
    // short of N even though every file was scanned (issue #815). Resolve the
    // full total now and carry it into the dead-code label so "scanned N files"
    // stays visible for the whole (longer) dead-code pass.
    const candidateFiles =
      lintFileCoverageState.value === null
        ? []
        : [
            ...new Set(
              lintFileCoverageState.value.candidateFiles.map((filePath) =>
                toNormalizedRelativePath(filePath, scanDirectory),
              ),
            ),
          ];
    const analyzedFiles =
      lintFileCoverageState.value === null
        ? []
        : [
            ...new Set(
              lintFileCoverageState.value.analyzedFiles.map((filePath) =>
                toNormalizedRelativePath(filePath, scanDirectory),
              ),
            ),
          ].sort();
    const totalFileCount =
      candidateFiles.length ||
      lastReportedTotalFileCount ||
      (lintIncludePaths?.length ?? project.sourceFileCount);
    const scannedFilePaths = input.suppressScanSummary
      ? candidateFiles.length > 0
        ? candidateFiles.map((filePath) => path.resolve(scanDirectory, filePath))
        : fallbackScannedFilePaths
      : [];
    const scannedFilesLabel = `${totalFileCount} ${totalFileCount === 1 ? "file" : "files"}`;

    // Resolve dead-code now that lint has settled. Three paths:
    //   • lint failed → no score, so dead-code is wasted: interrupt the forked
    //     fiber (its AbortSignal SIGKILLs the worker) / skip the inline run, and
    //     discard any result — preserving the pre-overlap short-circuit.
    //   • overlapped → the fiber has been running during lint; just join it.
    //   • sequential → run it inline after the "analyzing dead code" label.
    // The spinner label stays sequential (lint counter, then "analyzing dead
    // code") for clean output even though an overlapped fiber is often already
    // done by the time we get here — purely cosmetic.
    let deadCodeCollected: ReadonlyArray<Diagnostic> = [];
    if (lintFailureState.didFail) {
      if (deadCodeFiber !== null) yield* Fiber.interrupt(deadCodeFiber);
    } else if (shouldRunDeadCode) {
      const isDeadlineSpent =
        input.deadlineEpochMs !== undefined &&
        remainingDeadlineBudgetMs(input.deadlineEpochMs) === 0;
      if (isDeadlineSpent) {
        // Max-duration budget spent on lint — skip dead-code so a truncated
        // run nulls the score consistently whether the pass would have run
        // sequentially or was overlapped with lint. Interrupt an overlap
        // fiber rather than joining it past the budget.
        if (deadCodeFiber !== null) yield* Fiber.interrupt(deadCodeFiber);
        yield* Ref.set(deadCodeFailure, {
          didFail: true,
          reason: "Dead-code analysis skipped — max scan duration reached.",
        });
      } else {
        yield* scanProgress.update(`Scanned ${scannedFilesLabel}, analyzing dead code...`);
        // Sequential path: deslop gets the full core budget, and lint has already
        // reported the true file count — scale the timeout to it so a large repo's
        // legitimately-long pass isn't reclaimed before it finishes.
        const sequentialDeadCodeTimeout = resolveDeadCodeTimeout({
          sourceFileCount:
            input.retainExcludedProjectDeadCodeDiagnostics === true
              ? deadCodeSourceFileCount
              : totalFileCount,
          deadCodeConcurrency: scanConcurrency,
          fullConcurrency: scanConcurrency,
        });
        deadCodeCollected =
          deadCodeFiber !== null
            ? yield* Fiber.join(deadCodeFiber)
            : yield* buildCollectDeadCode({
                workerTimeoutMs: sequentialDeadCodeTimeout.workerTimeoutMs,
                phaseTimeoutMs: capOptionalToDeadline(deadCodePhaseTimeoutMs),
              });
      }
    }
    // On lint failure dead-code is discarded entirely, so a failure the forked
    // fiber may have recorded before we interrupted it must not leak into the
    // output — preserve the "lint failed ⇒ didDeadCodeFail: false" contract.
    const deadCodeFailureState = lintFailureState.didFail
      ? { didFail: false, reason: null }
      : yield* Ref.get(deadCodeFailure);

    const scanElapsedMilliseconds = Date.now() - scanStartTime;
    const scanElapsedSeconds = (scanElapsedMilliseconds / MILLISECONDS_PER_SECOND).toFixed(1);

    if (!lintFailureState.didFail) {
      if (deadCodeFailureState.didFail) {
        yield* scanProgress.fail(DEAD_CODE_FAIL_TEXT);
      } else if (input.suppressScanSummary) {
        yield* scanProgress.stop();
      } else {
        yield* scanProgress.succeed(
          `Scanned ${scannedFilesLabel} in ${scanElapsedSeconds}s${workerCountSuffix}`,
        );
      }
    }

    // Join the background supply-chain fiber now that lint + dead-code have
    // run, so its network time overlapped the lint pass. This lands BEFORE
    // `reporterService.finalize` so every supply-chain `Reporter.emit` from the
    // forked stream has flushed before a stateful reporter (e.g. NDJSON) closes
    // its sink. Fail-open + the fork-relative timeout are already folded into
    // the fiber result, so the join never fails; `timedOut` records whether the
    // overlap budget fired (the rare hung-socket guard) for telemetry.
    const supplyChainResult = yield* Fiber.join(supplyChainFiber);
    const supplyChainCollected = supplyChainResult.diagnostics;
    // Join the forked security scan (it overlapped lint). Its diagnostics are
    // kept regardless of lint outcome, mirroring the other environment checks.
    const securityScanCollected = yield* Fiber.join(securityScanFiber);

    yield* reporterService.finalize;

    // Stamp shared `fixGroupId`s once on the finalized list (post-collection,
    // pre-output), then sort into a total, content-stable order. The score
    // below runs on a surface-filtered COPY and ignores the field + is
    // set-based, so this stays score-neutral while the canonical order rides
    // into the wire report, the on-disk diagnostics dump, the agent handoff,
    // the Sentry wide event, and the scan-result cache — making all of them
    // reproducible run-to-run, independent of the (parallel, cost-reordered)
    // lint arrival order.
    const finalDiagnostics: ReadonlyArray<Diagnostic> = sortDiagnosticsStable(
      assignFixGroups([
        ...envCollected,
        ...securityScanCollected,
        ...supplyChainCollected,
        ...lintCollected,
        ...deadCodeCollected,
      ]),
    );

    const githubViewerPermission = yield* Fiber.join(githubViewerPermissionFiber);
    const scoreMetadata: ScoreRequestMetadata = {
      ...(repo !== null ? { repo } : {}),
      ...(sha !== null ? { sha } : {}),
      framework: project.framework,
      ...(project.reactVersion !== null ? { reactVersion: project.reactVersion } : {}),
      sourceFileCount: project.sourceFileCount,
      ...(defaultBranch !== null ? { defaultBranch } : {}),
      ...(input.doctorVersion !== undefined ? { doctorVersion: input.doctorVersion } : {}),
      ...(input.runId !== undefined ? { runId: input.runId } : {}),
      ...githubActionsScoreMetadata,
      ...(githubViewerPermission !== null ? { githubViewerPermission } : {}),
    };

    const scoreSurface: DiagnosticSurface = input.scoreSurface ?? "score";
    const scoreDiagnostics = filterDiagnosticsForSurface(
      [...finalDiagnostics],
      scoreSurface,
      resolvedConfig.config,
    );
    // Dead-code findings feed the scored set, so a failed or deadline-skipped
    // dead-code pass would leave the score computed over an incomplete set —
    // overstating health. Null it like a lint failure; a pass that was merely
    // disabled never sets `didFail`, so `--no-deslop` scans keep their score.
    const score =
      lintFailureState.didFail || deadCodeFailureState.didFail
        ? null
        : yield* scoreService.compute({
            diagnostics: scoreDiagnostics,
            isCi: input.isCi,
            metadata: scoreMetadata,
          });
    const lintPartialFailures = yield* Ref.get(partialFailuresRef);
    const didSecurityScanFail = yield* Ref.get(securityScanFailedRef);
    const securityScanFailed = didSecurityScanFail || didSecurityScanReachDeadline;
    let securityScanFailureReason: string | null = null;
    if (didSecurityScanReachDeadline) {
      securityScanFailureReason =
        "Security scan reached the max scan duration; findings collected before the deadline were preserved.";
    } else if (didSecurityScanFail) {
      securityScanFailureReason = "Security scan failed and was skipped.";
    }

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
      deadCodeOverlapped: shouldOverlapDeadCode,
      scannedFileCount: totalFileCount,
      scannedFilePaths,
      analyzedFiles,
      scanElapsedMilliseconds,
      scanConcurrency,
      supplyChainOverlapTimedOut: supplyChainResult.timedOut,
      securityScanFailed,
      securityScanFailureReason,
      lintCacheHitFileCount,
      lintCacheTotalFileCount,
      lintSidecarReplayedFileCount,
      lintSidecarTotalFileCount,
      // Lint failure discards the dead-code pass entirely (see
      // `deadCodeFailureState` above), so its cache outcomes must not leak.
      deadCodeCacheHit: lintFailureState.didFail ? null : deadCodeCacheHit,
      deadCodeSummaryCacheHits: lintFailureState.didFail ? null : deadCodeSummaryCacheHits,
      deadCodeSummaryCacheMisses: lintFailureState.didFail ? null : deadCodeSummaryCacheMisses,
      suppressedRuleCounts: transform.summarizeSuppressions(),
    };
  }).pipe(
    Effect.withSpan("runInspect", {
      attributes: {
        "inspect.directory": scrubSensitivePaths(input.directory),
        "inspect.includePathCount": input.includePaths.length,
        "inspect.runDeadCode": input.runDeadCode,
        "inspect.isCi": input.isCi,
        "inspect.scoreSurface": input.scoreSurface ?? "score",
      },
    }),
    (scanProgram) =>
      Effect.flatMap(ScanDeadlineMs, (scanDeadlineMs) => {
        if (scanDeadlineMs === null) return scanProgram;
        return scanProgram.pipe(
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
        );
      }),
  );
