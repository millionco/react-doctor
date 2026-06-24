import * as path from "node:path";
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
import { assignFixGroups } from "./utils/assign-fix-groups.js";
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
  DEAD_CODE_PHASE_TIMEOUT_MS,
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
import { resolveDeadCodeTimeout } from "./utils/resolve-dead-code-timeout.js";
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
import { SupplyChain } from "./services/supply-chain.js";
import type { ScoreRequestMetadata } from "./calculate-score.js";
import { resolveGithubActionsScoreMetadata } from "./utils/resolve-github-actions-score-metadata.js";
import { resolveScanConcurrency } from "./utils/resolve-scan-concurrency.js";

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
  /** Random per-run id. */
  readonly runId?: string;
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
  /**
   * When `true`, `includePaths` is linted verbatim instead of being
   * narrowed to JSX (`.tsx` / `.jsx`) files. The CLI's diff / staged
   * paths intentionally restrict to JSX so a changed-files scan stays
   * React-focused, but an editor scanning the exact buffer the user is
   * editing wants its diagnostics regardless of extension (custom
   * hooks, server actions, and module-level rules all fire in plain
   * `.ts`). Defaults to `false` to preserve the CLI contract.
   */
  readonly skipJsxIncludeFilter?: boolean;
  /**
   * Whether the scanned project's `package.json` is among the changed files
   * in a diff / staged scan. Dependency health is a whole-project property
   * (read from `package.json`, not the changed source files), so the
   * supply-chain check is normally skipped in diff mode — but a PR that edits
   * `package.json` should still have its dependencies scored. When `true`,
   * the supply-chain pass runs even in diff mode. Ignored on full scans
   * (those always run it). Defaults to `false`.
   */
  readonly supplyChainManifestChanged?: boolean;
  /**
   * Set when this scan runs concurrently with sibling scans in one process
   * (the CLI's multi-project pool). Such a scan can't safely reason about the
   * shared memory budget from its own available-memory reading — N concurrent
   * scans each reading "plenty available" would each fork a dead-code worker
   * and sum past the single-scan budget — so the dead-code overlap memory gate
   * (`"auto"`) stays sequential for concurrent members. An explicit
   * `REACT_DOCTOR_DEAD_CODE_OVERLAP=on` override still wins. Defaults to `false`.
   */
  readonly concurrentScan?: boolean;
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
   * Whether the dead-code pass actually ran concurrently with lint this scan
   * (the memory gate opened, or overlap was forced via
   * `REACT_DOCTOR_DEAD_CODE_OVERLAP`). `false` for the strictly-sequential
   * path: diff/staged/`--no-warnings` runs that skip dead-code, a closed
   * memory gate, or `overlap=off`. Internal telemetry only (rides the per-scan
   * wide event); NOT part of the public `inspect()` `InspectResult`.
   */
  readonly deadCodeOverlapped: boolean;
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
  /**
   * Resolved lint worker count the linter actually fanned out to (the
   * `OxlintConcurrency` Reference read through the spawn-boundary clamp).
   * Surfaced so CLI telemetry reports the real worker count on the auto
   * path, where the caller's `concurrency` option is `undefined`.
   */
  readonly scanConcurrency: number;
  /**
   * `true` when the background supply-chain fiber hit its overlap budget
   * (`SupplyChainOverlapTimeoutMs`) and failed open to no diagnostics — a
   * rare hung-socket guard, surfaced for telemetry. `false` on the healthy
   * path and whenever supply-chain was skipped (diff/staged scans).
   */
  readonly supplyChainOverlapTimedOut: boolean;
  /**
   * Per-file lint cache outcome for the lint pass: files served from cache and
   * total files considered. Both `null` when the cache was disabled or bypassed
   * (audit mode, adopted `extends`, user plugins) so the run never split. Fed
   * to the Sentry wide event as `lint.cacheHitRatio`.
   */
  readonly lintCacheHitFileCount: number | null;
  readonly lintCacheTotalFileCount: number | null;
}

/**
 * The settled result of the background supply-chain fiber: its collected
 * diagnostics, plus whether the fork-relative overlap timeout fired (in which
 * case `diagnostics` is empty — the fail-open outcome).
 */
interface SupplyChainForkResult {
  readonly diagnostics: ReadonlyArray<Diagnostic>;
  readonly timedOut: boolean;
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

    const explicitLintIncludePaths = input.skipJsxIncludeFilter
      ? input.includePaths.length > 0
        ? [...input.includePaths]
        : undefined
      : computeExplicitLintIncludePaths([...input.includePaths], project);
    const lintIncludePaths =
      explicitLintIncludePaths ??
      resolveLintIncludePaths(scanDirectory, resolvedConfig.config, project);

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
    // yields to the event loop between file chunks so it can't starve lint's
    // subprocess I/O or concurrently-scanning sibling projects. Skipped in
    // diff/staged mode like the env checks. The final stable sort makes the
    // concat order irrelevant, so output stays byte-identical to the serial path.
    const securityScanFiber = yield* Effect.forkChild(
      Stream.runCollect(
        applyPerElementPipeline(
          isDiffMode
            ? (Stream.empty as Stream.Stream<Diagnostic, never>)
            : Stream.unwrap(
                Effect.promise(() =>
                  checkSecurityScanCooperative(scanDirectory, {
                    project,
                    ignoredTags: input.ignoredTags,
                  }),
                ).pipe(Effect.map((diagnostics) => Stream.fromIterable(diagnostics))),
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
    // timeout, a stateful `Reporter` — only `layerNdjson`, which has no in-tree
    // consumer — may hold supply-chain emits from before the deadline that the
    // returned `[]` omits; production `Reporter.layerNoop` makes emit a no-op,
    // and the returned `diagnostics`/score only ever read the joined value.)
    // When skipped, the fork takes the empty branch so the join below stays
    // unconditional (mirroring the viewer-permission fiber above).
    const shouldRunSupplyChain = !isDiffMode || (input.supplyChainManifestChanged ?? false);
    const supplyChainOverlapTimeout = yield* SupplyChainOverlapTimeoutMs;
    const supplyChainFiber = yield* Effect.forkChild(
      shouldRunSupplyChain
        ? Stream.runCollect(
            applyPerElementPipeline(
              supplyChainService.run({
                rootDirectory: scanDirectory,
                userConfig: resolvedConfig.config,
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
    // The dead-code phase timeout normally tracks the file-count-scaled worker
    // timeout (`resolveDeadCodeTimeout`), so a large repo's legitimately-long
    // pass isn't reclaimed before it finishes. But an EXPLICIT override (an env
    // value or a test `Layer` that sets it off its default) is honored verbatim
    // — tests pin it low to exercise the skip path, and that intent must win
    // over the scaling.
    const resolveDeadCodePhaseTimeoutMs = (scaledPhaseTimeoutMs: number): number =>
      deadCodePhaseTimeoutMs === DEAD_CODE_PHASE_TIMEOUT_MS
        ? scaledPhaseTimeoutMs
        : deadCodePhaseTimeoutMs;
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

    // Runs either forked (overlap) or inline (sequential) with the same pipeline
    // + failure Ref. The timeout is a parameter because it scales with the repo's
    // source-file count — known accurately only after lint, on the sequential
    // path. Building this is side-effect-free; the worker spawns only when the
    // effect runs.
    const buildCollectDeadCode = (deadCodeTimeout: {
      workerTimeoutMs: number;
      phaseTimeoutMs: number;
    }) =>
      Stream.runCollect(
        applyPerElementPipeline(
          deadCodeService
            .run({
              rootDirectory: scanDirectory,
              userConfig: resolvedConfig.config,
              parseConcurrency: deadCodeParseConcurrency,
              workerTimeoutMs: deadCodeTimeout.workerTimeoutMs,
            })
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
      ).pipe(
        // Dead-code phase cap (Effect-side): sits ABOVE the in-worker SIGKILL
        // timer as a runtime-independent backstop for a starved event loop. On
        // timeout, fold into the existing dead-code skip contract and yield an
        // empty chunk so the scan still completes.
        Effect.timeoutOption(deadCodeTimeout.phaseTimeoutMs),
        Effect.flatMap(
          Option.match({
            onNone: () =>
              Ref.set(deadCodeFailure, {
                didFail: true,
                reason: `Dead-code analysis exceeded ${Math.round(
                  deadCodeTimeout.phaseTimeoutMs / MILLISECONDS_PER_SECOND,
                )}s and was skipped.`,
              }).pipe(Effect.as<Diagnostic[]>([])),
            onSome: Effect.succeed,
          }),
        ),
      );
    // The overlap fork happens BEFORE lint, so the lint-reported file count isn't
    // known yet — scale the timeout off the project's discovered source count and
    // the reduced core share. (`forkChild`, not `startImmediately`: the lint
    // `Stream.runCollect` below blocks the parent on async oxlint spawns, yielding
    // the runtime to this child so it runs DURING lint. Auto-supervised —
    // interrupted if the parent dies.)
    const overlapDeadCodeTimeout = resolveDeadCodeTimeout({
      sourceFileCount: project.sourceFileCount,
      deadCodeConcurrency: deadCodeParseConcurrency ?? scanConcurrency,
      fullConcurrency: scanConcurrency,
    });
    const deadCodeFiber = shouldOverlapDeadCode
      ? yield* Effect.forkChild(
          buildCollectDeadCode({
            workerTimeoutMs: overlapDeadCodeTimeout.workerTimeoutMs,
            phaseTimeoutMs: resolveDeadCodePhaseTimeoutMs(overlapDeadCodeTimeout.phaseTimeoutMs),
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
        onCacheStats: (cacheHitFileCount, totalConsideredFileCount) => {
          lintCacheHitFileCount = cacheHitFileCount;
          lintCacheTotalFileCount = totalConsideredFileCount;
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
    const lintCollected = yield* Stream.runCollect(applyPerElementPipeline(rawLintStream)).pipe(
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
    const totalFileCount =
      lastReportedTotalFileCount || (lintIncludePaths?.length ?? project.sourceFileCount);
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
      yield* scanProgress.update(`Scanned ${scannedFilesLabel}, analyzing dead code...`);
      // Sequential path: deslop gets the full core budget, and lint has already
      // reported the true file count — scale the timeout to it so a large repo's
      // legitimately-long pass isn't reclaimed before it finishes.
      const sequentialDeadCodeTimeout = resolveDeadCodeTimeout({
        sourceFileCount: totalFileCount,
        deadCodeConcurrency: scanConcurrency,
        fullConcurrency: scanConcurrency,
      });
      deadCodeCollected =
        deadCodeFiber !== null
          ? yield* Fiber.join(deadCodeFiber)
          : yield* buildCollectDeadCode({
              workerTimeoutMs: sequentialDeadCodeTimeout.workerTimeoutMs,
              phaseTimeoutMs: resolveDeadCodePhaseTimeoutMs(
                sequentialDeadCodeTimeout.phaseTimeoutMs,
              ),
            });
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
      deadCodeOverlapped: shouldOverlapDeadCode,
      scannedFileCount: totalFileCount,
      scannedFilePaths,
      scanElapsedMilliseconds,
      scanConcurrency,
      supplyChainOverlapTimedOut: supplyChainResult.timedOut,
      lintCacheHitFileCount,
      lintCacheTotalFileCount,
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
