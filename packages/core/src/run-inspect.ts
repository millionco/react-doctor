import * as os from "node:os";
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
import { buildDiagnosticPipeline } from "./build-diagnostic-pipeline.js";
import { checkExpoProject } from "./check-expo-project.js";
import { checkPnpmHardening } from "./check-pnpm-hardening.js";
import { checkReactNativeProject } from "./check-react-native-project.js";
import { checkReactServerComponentsAdvisory } from "./check-react-server-components-advisory.js";
import { checkReducedMotion } from "./check-reduced-motion.js";
import { checkSecurityScan } from "./check-security-scan.js";
import { DEFAULT_SHOW_WARNINGS, MILLISECONDS_PER_SECOND } from "./constants.js";
import { highlighter } from "./highlighter.js";
import { computeExplicitLintIncludePaths } from "./explicit-lint-include-paths.js";
import { deadCodeMaySurfaceWhenWarningsHidden } from "./utils/dead-code-may-surface.js";
import {
  NoReactDependency,
  type OxlintUnavailable,
  ReactDoctorError,
  type ReactDoctorErrorReason,
} from "./errors.js";
import { filterDiagnosticsForSurface } from "./filter-for-surface.js";
import { isAnalyzableProject } from "./project-info/index.js";
import { DeadCodeOverlap, OxlintConcurrency } from "./refs.js";
import { hasDeadCodeOverlapHeadroom } from "./utils/has-dead-code-overlap-headroom.js";
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
 *   3. environment checks (reduced-motion + pnpm hardening +
 *      expo/react-native + security scan)
 *   4. Linter.run runs; DeadCode.run runs concurrently (forked child
 *      fiber) ONLY when the memory gate has headroom to run the 8 GB
 *      dead-code child alongside the oxlint workers — or when overlap is
 *      forced via REACT_DOCTOR_DEAD_CODE_OVERLAP. Otherwise dead-code
 *      runs sequentially after lint, exactly as it did pre-overlap. The
 *      fiber is joined (or interrupted, SIGKILLing its worker, on lint
 *      failure) before diagnostics are concatenated. Progress spinner
 *      labels AND the final diagnostic / score order stay independent of
 *      execution order, so terminal output is identical either way.
 *      GitHub viewer permission also runs as a background fiber during
 *      this phase.
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
    const environmentDiagnostics: ReadonlyArray<Diagnostic> = isDiffMode
      ? []
      : [
          ...checkReducedMotion(scanDirectory),
          ...checkPnpmHardening(scanDirectory),
          ...checkReactServerComponentsAdvisory(scanDirectory, project),
          ...checkExpoProject(scanDirectory, project),
          ...checkReactNativeProject(scanDirectory, project),
          ...checkSecurityScan(scanDirectory, { project, ignoredTags: input.ignoredTags }),
        ];
    const envCollected = yield* Stream.runCollect(
      applyPerElementPipeline(Stream.fromIterable(environmentDiagnostics)),
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
    const shouldRunSupplyChain = !isDiffMode || (input.supplyChainManifestChanged ?? false);
    const supplyChainCollected = shouldRunSupplyChain
      ? yield* Stream.runCollect(
          applyPerElementPipeline(
            supplyChainService.run({
              rootDirectory: scanDirectory,
              userConfig: resolvedConfig.config,
            }),
          ),
        )
      : [];

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

    // ── Dead-code overlap plan (decided before lint so we can fork it) ──
    // Reachability is a whole-project property independent of lint output, so
    // dead-code can run DURING lint instead of strictly after. But overlapping
    // the 8 GB dead-code child with up to MAX_SCAN_CONCURRENCY oxlint children
    // SUMS their peak RSS — exactly the pressure the dead-code worker already
    // OOMs under on type-heavy repos — so overlap is gated on a one-shot
    // free-memory check (or forced via the DeadCodeOverlap knob). When the gate
    // stays closed we fall back to the strictly-sequential collect below, with
    // zero behavior change. `os.freemem()` is read once, here, at fork time.
    //
    // Dead-code emits only `"warning"`-severity diagnostics (the `deslop`
    // plugin, all `Maintainability`); warnings show by default, so this
    // normally runs. Only `--no-warnings` / `warnings: false` filters its
    // output out entirely before any surface or the score, making the
    // expensive pass pure wasted work — so skip it then, unless a severity
    // override restamps dead-code findings so they survive the global hide.
    const shouldRunDeadCode =
      input.runDeadCode &&
      !isDiffMode &&
      (showWarnings || deadCodeMaySurfaceWhenWarningsHidden(resolvedConfig.config));
    const deadCodeOverlapMode = yield* DeadCodeOverlap;
    const shouldOverlapDeadCode =
      shouldRunDeadCode &&
      deadCodeOverlapMode !== "off" &&
      (deadCodeOverlapMode === "on" ||
        hasDeadCodeOverlapHeadroom({ workerCount: scanConcurrency, freeBytes: os.freemem() }));

    // The dead-code collection, named once so it runs either forked (overlap)
    // or inline (sequential) — identical pipeline, identical failure Ref.
    // Building it is side-effect-free; the worker spawns only when it runs.
    const collectDeadCode = Stream.runCollect(
      applyPerElementPipeline(
        deadCodeService
          .run({ rootDirectory: scanDirectory, userConfig: resolvedConfig.config })
          .pipe(
            Stream.catchTag("ReactDoctorError", (error: ReactDoctorError) =>
              Stream.unwrap(
                Effect.gen(function* () {
                  yield* Ref.set(deadCodeFailure, { didFail: true, reason: error.message });
                  return Stream.empty as Stream.Stream<Diagnostic, never>;
                }),
              ),
            ),
          ),
      ),
    );
    // Default `forkChild` (not `startImmediately`): the lint `Stream.runCollect`
    // below blocks the parent on async oxlint spawns, yielding the runtime to
    // this child so it runs DURING lint. Auto-supervised — interrupted if the
    // parent dies. Mirrors `githubViewerPermissionFiber` above.
    const deadCodeFiber = shouldOverlapDeadCode ? yield* Effect.forkChild(collectDeadCode) : null;

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
      deadCodeCollected =
        deadCodeFiber !== null ? yield* Fiber.join(deadCodeFiber) : yield* collectDeadCode;
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

    yield* reporterService.finalize;

    // Stamp shared `fixGroupId`s once on the finalized list (post-collection,
    // pre-output). The score below runs on a surface-filtered COPY and ignores
    // the field, so this stays score-neutral while the id rides into the wire
    // report, the on-disk diagnostics dump, and every CLI surface.
    const finalDiagnostics: ReadonlyArray<Diagnostic> = assignFixGroups([
      ...envCollected,
      ...supplyChainCollected,
      ...lintCollected,
      ...deadCodeCollected,
    ]);

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
