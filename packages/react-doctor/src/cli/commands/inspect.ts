import { tmpdir } from "node:os";
import * as path from "node:path";
import { performance } from "node:perf_hooks";
import * as Effect from "effect/Effect";
import * as fs from "node:fs";
import {
  buildJsonReport,
  DEFAULT_PROJECT_SCAN_CONCURRENCY,
  getBaselineDiffPlan,
  getChangedLineRanges,
  getDiffInfo,
  hasReactRuntime,
  highlighter,
  mapWithConcurrency,
  mergeReactDoctorConfigs,
  resolveScanTarget,
  toRelativePath,
} from "@react-doctor/core";
import { inspect } from "../../inspect.js";
import { flushSentry } from "../../instrument.js";
import type {
  DiffInfo,
  InspectResult,
  JsonReportMode,
  ReactDoctorConfig,
} from "@react-doctor/core";
import type { RequestedScope } from "../utils/resolve-scope.js";
import { cliLogger as logger } from "../utils/cli-logger.js";
import { METRIC, STAGED_FILES_TEMP_DIR_PREFIX } from "../utils/constants.js";
import { recordCount } from "../utils/record-metric.js";
import { getStagedSourceFiles, materializeStagedFiles } from "../utils/get-staged-files.js";
import type { InspectFlags } from "../utils/inspect-flags.js";
import { filterDiagnosticsByCategories } from "../utils/filter-diagnostics-by-categories.js";
import { handleError, handleUserError } from "../utils/handle-error.js";
import { isDebugFlagEnabled } from "../utils/is-debug-flag.js";
import { isShareOptedOut } from "../utils/is-share-opted-out.js";
import { isExpectedUserError } from "../utils/is-expected-user-error.js";
import { handoffToAgent } from "../utils/handoff-to-agent.js";
import { runProjectMigrations } from "../utils/cli-migrations.js";
import {
  enableJsonMode,
  setJsonReportDirectory,
  setJsonReportMode,
  writeJsonErrorReport,
  writeJsonReport,
} from "../utils/json-mode.js";
import { canAnimateOnboarding, isOnboardingForced } from "../utils/onboarding-pacing.js";
import { hasCompletedOnboarding } from "../utils/onboarding-state.js";
import { printBrandedHeader } from "../utils/print-branded-header.js";
import { playWelcomeScene, RETURNING_USER_SPEED_MULTIPLIER } from "../utils/render-welcome.js";
import { reportErrorToSentry } from "../utils/report-error.js";
import { readChangedFilesFrom } from "../utils/read-changed-files-from.js";
import { printMultiProjectSummary } from "../utils/render-multi-project-summary.js";
import { printDiagnosticsDump } from "../utils/render-summary.js";
import { isCiOrCodingAgentEnvironment } from "../utils/is-ci-environment.js";
import {
  disableSetupPrompt,
  printAgentInstallHint,
  resolveInstallSetupProjectRoot,
  shouldShowAgentInstallHint,
} from "../utils/prompt-install-setup.js";
import { resolveCliInspectOptions } from "../utils/resolve-cli-inspect-options.js";
import type { CliInspectOptions } from "../utils/resolve-cli-inspect-options.js";
import { finalizeScope, resolveScope, warnDeprecatedDiff } from "../utils/resolve-scope.js";
import { resolveMergeBaseRef } from "../utils/materialize-baseline-files.js";
import { resolveBlockingLevel } from "../utils/resolve-blocking-level.js";
import {
  resolveProjectChangedLineRanges,
  resolveProjectDiffIncludePaths,
} from "../utils/resolve-project-diff-include-paths.js";
import { resolveProjectSourceFilePaths } from "../utils/resolve-project-source-file-paths.js";
import { runExplain } from "../utils/run-explain.js";
import { projectManifestChanged } from "../utils/project-manifest-changed.js";
import { filterScansForSurface } from "../utils/filter-scans-for-surface.js";
import { selectProjects } from "../utils/select-projects.js";
import { isSpinnerSilent, setSpinnerSilent, spinner } from "../utils/spinner.js";
import { shouldFailScanGate } from "../utils/should-fail-scan-gate.js";
import { shouldSkipPrompts } from "../utils/should-skip-prompts.js";
import { warnDeprecatedFailOn } from "../utils/warn-deprecated-fail-on.js";
import { warnIfAiTrainingEnvironment } from "../utils/warn-ai-training-environment.js";
import { validateIncludeUntrackedScope, validateModeFlags } from "../utils/validate-mode-flags.js";
import { VERSION } from "../utils/version.js";
import { findStagedSnapshotDivergences } from "../utils/find-staged-snapshot-divergences.js";
import { CliInputError } from "../utils/cli-input-error.js";

interface CompletedScan {
  directory: string;
  result: InspectResult;
  // The merged (root + module) config the scan ran under — surface
  // filtering of its diagnostics must use this, not the root config.
  config: ReactDoctorConfig | null;
}

const filterCompletedScansByCategories = (
  completedScans: ReadonlyArray<CompletedScan>,
  categoryFilters: ReadonlySet<string>,
): CompletedScan[] => {
  if (categoryFilters.size === 0) return [...completedScans];

  return completedScans.map((scan) => ({
    ...scan,
    result: {
      ...scan.result,
      diagnostics: filterDiagnosticsByCategories(scan.result.diagnostics, categoryFilters),
    },
  }));
};

interface FinalizeScansInput {
  readonly completedScans: CompletedScan[];
  readonly mode: JsonReportMode;
  readonly diff: DiffInfo | null;
  /**
   * True when a baseline comparison was attempted (a committed diff against a
   * base). If it produced no delta — the base ref was unfetchable, or the head
   * or base lint failed — the run degrades to a plain diff: findings stay
   * visible but the gate is skipped (don't block on uncertain attribution).
   */
  readonly baselineIntended: boolean;
  readonly isJsonMode: boolean;
  readonly isScoreOnly: boolean;
  readonly flags: InspectFlags;
  readonly categoryFilters: ReadonlySet<string>;
  readonly userConfig: ReactDoctorConfig | null;
  readonly resolvedDirectory: string;
  readonly startTime: number;
}

/**
 * Post-scan finalization shared by the staged-arm and project-loop
 * paths of `inspectAction`: emit the JSON report (when in JSON mode)
 * and set `process.exitCode = 1` when any scan's lint pass hard-failed
 * (an engine/plugin/binding failure destroys the findings, so success
 * would be a false clean) or a diagnostic at or above the `--blocking`
 * threshold (default `"error"`) reaches the `ciFailure` surface.
 * `--blocking none` keeps the scan advisory (always exits 0), and
 * fail-open degradations — `--no-lint`, `--max-duration` truncation,
 * supply-chain/security skips — stay advisory too, surfaced through
 * `complete: false` in the JSON report.
 */
const finalizeScans = (input: FinalizeScansInput): void => {
  // Aggregate the per-project baseline deltas into one report-level block so the
  // JSON (and the GitHub Action) sees a single new/fixed total across a
  // workspace scan. Present only when at least one project produced a delta.
  const baselineDeltas = input.completedScans.flatMap((scan) =>
    scan.result.baselineDelta ? [scan.result.baselineDelta] : [],
  );
  // Baseline succeeded only if at least one project ran AND every scanned
  // project produced a delta. Otherwise — a project's base ref was unfetchable,
  // its head/base lint failed, or no project had changed source to scan — the
  // run degrades to a plain diff: report `diff` not `baseline`, drop the baseline
  // block, and skip the gate so CI never blocks on findings whose
  // new-vs-pre-existing attribution is unknown. Findings stay visible. (An empty
  // scan set is degraded too, so it can't slip through as a "clean baseline".)
  //
  // v1 limitation: in a partial-degraded workspace, sibling projects that DID
  // compute a delta still expose only their introduced diagnostics (filtering
  // happens per project inside `inspect()`), so a degraded run under-shows their
  // pre-existing issues. The gate is still correct (it never blocks here);
  // surfacing full findings everywhere would mean deferring per-project
  // filtering out of `inspect()` (an InspectResult contract change) — a v2
  // follow-up. Single-project and all-succeed runs are unaffected.
  const baselineComputed =
    input.completedScans.length > 0 &&
    input.completedScans.every((scan) => scan.result.baselineDelta !== undefined);
  const baselineDegraded = input.baselineIntended && !baselineComputed;
  const mode: JsonReportMode = baselineDegraded ? "diff" : input.mode;
  const isReactDetected = input.completedScans.some((scan) => hasReactRuntime(scan.result.project));
  if (input.completedScans.length > 0 && !isReactDetected) {
    recordCount(METRIC.scanNoReactDetected, 1);
    logger.warn(
      `No React project detected at ${input.resolvedDirectory} — React rules were gated off; this is not the same as a clean scan.`,
    );
  }
  const jsonCompletedScans = filterCompletedScansByCategories(
    input.completedScans,
    input.categoryFilters,
  );

  if (input.isJsonMode) {
    const baseline =
      baselineComputed && baselineDeltas.length > 0
        ? {
            baseRef: baselineDeltas[0].baseRef,
            fixedCount: baselineDeltas.reduce((total, delta) => total + delta.fixedCount, 0),
            baseTotalCount: baselineDeltas.reduce(
              (total, delta) => total + delta.baseTotalCount,
              0,
            ),
          }
        : undefined;
    writeJsonReport(
      buildJsonReport({
        version: VERSION,
        directory: input.resolvedDirectory,
        mode,
        diff: input.diff,
        scans: jsonCompletedScans,
        totalElapsedMilliseconds: performance.now() - input.startTime,
        baseline,
        baselineDegraded,
      }),
    );
  }

  const blockingLevel = resolveBlockingLevel(input.flags, input.userConfig);
  if (
    shouldFailScanGate({
      scans: input.completedScans,
      blockingLevel,
      diagnosticsAreGateExempt: input.isScoreOnly || baselineDegraded,
    })
  ) {
    process.exitCode = 1;
  }
};

const buildChangedFilesDiffInfo = (changedFiles: string[]): DiffInfo => ({
  currentBranch: process.env.GITHUB_HEAD_REF?.trim() || null,
  baseBranch: process.env.GITHUB_BASE_REF?.trim() || "pull request target",
  // The GitHub Action forwards the PR base commit so baseline mode can read
  // base content against a SHA that's actually fetched (branch names rarely
  // resolve in a shallow PR checkout). Empty in non-Action runs.
  baseSha: process.env.REACT_DOCTOR_BASE_SHA?.trim() || undefined,
  changedFiles,
  isCurrentChanges: false,
});

interface MigrationGuardInput {
  readonly isQuiet: boolean;
  readonly isStaged: boolean;
}

/**
 * On an interactive human run, rename a pre-migration
 * `react-doctor.config.json` to `doctor.config.ts` before config is loaded,
 * so the scan reads the renamed file and the user is told once. CI, coding
 * agents, JSON/score output, pre-commit (`--staged`) hooks, and non-TTY runs
 * are left untouched — the loader still reads the legacy file as a deprecated
 * fallback and warns — so a scan never mutates the repo unattended.
 */
const maybeMigrateLegacyConfig = async (
  requestedDirectory: string,
  { isQuiet, isStaged }: MigrationGuardInput,
): Promise<void> => {
  const isInteractiveHumanRun =
    !isQuiet && !isStaged && process.stdout.isTTY === true && !isCiOrCodingAgentEnvironment();
  if (!isInteractiveHumanRun) return;

  // Runs every pending per-repo migration (see PROJECT_MIGRATIONS); each is
  // tracked so it applies at most once. The migrations themselves print their
  // own user-facing summary.
  await runProjectMigrations(requestedDirectory);
};

export const inspectAction = async (
  directory: string,
  flags: InspectFlags,
  invocationCommand = "inspect",
): Promise<void> => {
  const isScoreOnly = Boolean(flags.score);
  const isJsonMode = Boolean(flags.json);
  const isQuiet = isScoreOnly || isJsonMode;
  const requestedDirectory = path.resolve(directory);
  const startTime = performance.now();

  if (isJsonMode) {
    enableJsonMode({
      compact: Boolean(flags.jsonCompact),
      directory: requestedDirectory,
      outputFile: flags.jsonOut,
    });
    // `--json-out` only takes effect in JSON mode, so the adoption metric lives
    // here too — outside the guard it would also count `--json-out` without
    // `--json`, where the flag is a no-op.
    if (flags.jsonOut) recordCount(METRIC.jsonOutUsed, 1);
  }
  // Recorded after JSON mode is enabled so the metric's run attributes reflect
  // the true `jsonMode` (run context is rebuilt per emit in `record-metric.ts`).
  recordCount(METRIC.cliInvoked, 1, { command: invocationCommand });

  try {
    validateModeFlags(flags);

    if (flags.staged) setJsonReportMode("staged");

    await maybeMigrateLegacyConfig(requestedDirectory, {
      isQuiet,
      isStaged: Boolean(flags.staged),
    });

    const scanTarget = await resolveScanTarget(requestedDirectory, { allowAmbiguous: true });
    const userConfig = scanTarget.userConfig;
    const resolvedDirectory = scanTarget.resolvedDirectory;
    setJsonReportDirectory(resolvedDirectory);
    warnDeprecatedFailOn(flags, userConfig);
    // Emitted on every path (including the early-returning `--staged` branch),
    // so the deprecation nudge fires whenever `--diff` / `diff` is set.
    warnDeprecatedDiff(flags, userConfig);
    warnIfAiTrainingEnvironment();
    if (scanTarget.didRedirectViaRootDir && !isQuiet) {
      logger.dim(
        `Redirected to ${highlighter.info(toRelativePath(resolvedDirectory, requestedDirectory))} via react-doctor config "rootDir".`,
      );
      logger.break();
    }

    // Checked against the resolved directory (after any `rootDir` redirect) —
    // the staged scan materializes from there, so a divergence check on the
    // requested directory would let a redirected repo's mixed snapshot through.
    if (flags.staged) {
      const divergentConfigFiles = findStagedSnapshotDivergences(resolvedDirectory);
      if (divergentConfigFiles === null) {
        throw new CliInputError(
          "Could not verify that staged configuration matches the worktree. Run the command from a Git worktree with Git available.",
        );
      }
      if (divergentConfigFiles.length > 0) {
        recordCount(METRIC.stagedSnapshotDivergence, 1, {
          divergentInputCount: divergentConfigFiles.length,
        });
        throw new CliInputError(
          `Cannot scan staged files while configuration differs between the index and worktree: ${divergentConfigFiles.join(", ")}. Stage or restore those files, then rerun react-doctor --staged.`,
        );
      }
    }

    const explainArgument = flags.explain;
    if (explainArgument !== undefined) {
      await runExplain(explainArgument, {
        resolvedDirectory,
        userConfig,
        scanOptions: resolveCliInspectOptions(flags, userConfig),
        projectFlag: flags.project,
      });
      return;
    }

    if (!isQuiet) {
      // Interactive regular runs open with the animated welcome scene in place
      // of the static branded header. `--verbose` is a power-user review mode
      // (the same user typed `--verbose` on purpose), so the intro is skipped
      // entirely there and the static header takes over. Returning users in
      // regular mode get a much snappier replay (`RETURNING_USER_SPEED_MULTIPLIER`)
      // since they've already seen the full first-run pitch.
      const showWelcome = !flags.verbose && canAnimateOnboarding(process.stdout);
      if (showWelcome) {
        const isReturningUser = !isOnboardingForced() && hasCompletedOnboarding();
        await Effect.runPromise(
          playWelcomeScene({
            speedMultiplier: isReturningUser ? RETURNING_USER_SPEED_MULTIPLIER : 1,
          }),
        );
      } else {
        Effect.runSync(printBrandedHeader);
      }
    }

    const scanOptions: CliInspectOptions = resolveCliInspectOptions(flags, userConfig);
    // One `--max-duration` budget per invocation, shared by every project of a
    // workspace scan: fix the absolute deadline once here and hand it to each
    // project's `inspect()` (rather than restarting the budget per project).
    // `maxDurationMs` on `scanOptions` stays the configured value so telemetry
    // reports what the user set, not each project's leftover.
    const scanDeadlineEpochMs =
      scanOptions.maxDurationMs !== undefined ? Date.now() + scanOptions.maxDurationMs : undefined;
    const categoryFilters = new Set(scanOptions.categoryFilters ?? []);
    const skipPrompts = shouldSkipPrompts({ yes: flags.yes, json: flags.json });

    if (flags.staged) {
      const stagedFiles = await getStagedSourceFiles(resolvedDirectory);
      if (stagedFiles.length === 0) {
        if (isJsonMode) {
          writeJsonReport(
            buildJsonReport({
              version: VERSION,
              directory: resolvedDirectory,
              mode: "staged",
              diff: null,
              scans: [],
              totalElapsedMilliseconds: performance.now() - startTime,
            }),
          );
        } else if (!isScoreOnly) {
          logger.dim("No staged source files found.");
        }
        return;
      }

      if (!isQuiet) {
        logger.log(`Scanning ${highlighter.info(`${stagedFiles.length}`)} staged files...`);
        logger.break();
      }

      const tempDirectory = fs.mkdtempSync(path.join(tmpdir(), STAGED_FILES_TEMP_DIR_PREFIX));
      // If materialization throws before `snapshot.cleanup` is wired up,
      // remove the temp dir we just created so it can't leak.
      const snapshot = await materializeStagedFiles(
        resolvedDirectory,
        stagedFiles,
        tempDirectory,
      ).catch((error: unknown) => {
        fs.rmSync(tempDirectory, { recursive: true, force: true });
        throw error;
      });
      // `--staged --scope lines`: only report issues on the staged hunks. The
      // index diff (`--cached`) is keyed by the same relative paths the staged
      // snapshot mirrors, so the ranges match the scan's diagnostics. A `null`
      // result (git diff failed) degrades to file-level rather than hiding
      // everything behind an empty filter.
      const stagedWantsLines = resolveScope(flags, userConfig).scope === "lines";
      const stagedLineRanges = stagedWantsLines
        ? await getChangedLineRanges({
            directory: resolvedDirectory,
            cached: true,
            files: snapshot.stagedFiles,
          })
        : null;
      if (stagedWantsLines && stagedLineRanges === null && !isQuiet) {
        logger.warn(
          "Could not determine staged changed lines; reporting all issues in staged files.",
        );
        logger.break();
      }
      try {
        const scanResult = await inspect(snapshot.tempDirectory, {
          ...scanOptions,
          deadlineEpochMs: scanDeadlineEpochMs,
          includePaths: snapshot.stagedFiles,
          configOverride: userConfig,
          // Resolve `config.plugins` from the real config directory — the
          // staged temp snapshot has no node_modules or plugin files, so
          // anchoring resolution there silently drops every custom plugin
          // from pre-commit scans.
          configSourceDirectory: scanTarget.configSourceDirectory ?? undefined,
          changedLineRanges: stagedLineRanges ?? undefined,
        });

        const remappedDiagnostics = scanResult.diagnostics.map((diagnostic) => ({
          ...diagnostic,
          filePath: path.isAbsolute(diagnostic.filePath)
            ? diagnostic.filePath.replaceAll(snapshot.tempDirectory, () => resolvedDirectory)
            : diagnostic.filePath,
        }));
        const remappedInspectResult: InspectResult = {
          ...scanResult,
          diagnostics: remappedDiagnostics,
          project: { ...scanResult.project, rootDirectory: resolvedDirectory },
        };

        finalizeScans({
          completedScans: [
            { directory: resolvedDirectory, result: remappedInspectResult, config: userConfig },
          ],
          mode: "staged",
          diff: null,
          baselineIntended: false,
          isJsonMode,
          isScoreOnly,
          flags,
          categoryFilters,
          userConfig,
          resolvedDirectory,
          startTime,
        });
      } finally {
        snapshot.cleanup();
      }
      return;
    }

    const projectDirectories = await selectProjects(
      resolvedDirectory,
      flags.project,
      skipPrompts,
      userConfig?.projects,
    );

    const changedFilesDiffInfo = flags.changedFilesFrom
      ? buildChangedFilesDiffInfo(readChangedFilesFrom(path.resolve(flags.changedFilesFrom)))
      : null;
    const requestedScope = resolveScope(flags, userConfig);
    // Untracked files only exist in a local working tree, so this is a
    // CLI-only modifier (like `--staged`) — off unless the user opts in.
    const includeUntracked = flags.includeUntracked ?? false;
    // The internal `--changed-files-from` path (the GitHub Action) implies the
    // `changed` scope when the user didn't pick one explicitly — it always ran
    // in diff mode historically.
    const scopeRequest: RequestedScope =
      requestedScope.scope === undefined && changedFilesDiffInfo !== null
        ? { ...requestedScope, scope: "changed" }
        : requestedScope;
    // Validate against the EFFECTIVE scope (post `--changed-files-from`
    // promotion), so a working-tree scope from a flag, `config.scope` /
    // `config.diff`, or that internal path all satisfy the requirement.
    validateIncludeUntrackedScope(includeUntracked, scopeRequest.scope);
    const wantsDiffMode = scopeRequest.scope !== undefined && scopeRequest.scope !== "full";
    // HACK: also call getDiffInfo when we MIGHT prompt the user — without it the
    // "full vs changed" prompt never appears for users on a feature branch who
    // didn't explicitly pass a scope.
    const shouldDetectDiff =
      changedFilesDiffInfo === null &&
      (wantsDiffMode || (scopeRequest.scope === undefined && !skipPrompts && !isQuiet));
    const diffInfo =
      changedFilesDiffInfo ??
      (shouldDetectDiff
        ? await getDiffInfo(resolvedDirectory, scopeRequest.base, includeUntracked)
        : null);
    const scope = await finalizeScope({ requested: scopeRequest, diffInfo, skipPrompts, isQuiet });
    const isDiffMode = scope !== "full";

    // The commit a baseline / line-range diff compares against. When diffing
    // against a base ref (not just uncommitted changes), read base content from
    // the SAME commit the file diff was taken against so the file set and the
    // base snapshot agree. The GitHub Action forwards the PR base SHA — three-dot
    // PR semantics, so merge-base it with HEAD; a local diff already knows its
    // exact base (`diffBaseRef`). `null` when uncommitted, detached, or git is
    // unavailable. Shared by `changed` (baseline) and `lines` (hunk ranges).
    const comparisonBaseRef =
      isDiffMode && diffInfo && !diffInfo.isCurrentChanges
        ? diffInfo.baseSha
          ? await resolveMergeBaseRef(resolvedDirectory, diffInfo.baseSha)
          : (diffInfo.diffBaseRef ??
            (await resolveMergeBaseRef(resolvedDirectory, diffInfo.baseBranch)))
        : null;
    // `changed` subtracts pre-existing findings (baseline); `files` / `lines` do not.
    const baselineRef = scope === "changed" ? comparisonBaseRef : null;
    const baselineDiffPlan =
      baselineRef === null ? null : await getBaselineDiffPlan(resolvedDirectory, baselineRef);

    // `--scope lines`: per-file changed line ranges (repo-relative). Working-tree
    // vs HEAD for uncommitted changes, vs the merge-base otherwise. When no base
    // resolves we can't tell which lines changed, so degrade to `files` (report
    // every finding in the changed files) rather than hiding everything.
    const linesBaseRef = diffInfo?.isCurrentChanges ? "HEAD" : comparisonBaseRef;
    const canComputeLines =
      scope === "lines" &&
      diffInfo !== null &&
      (diffInfo.isCurrentChanges || linesBaseRef !== null);
    // `null` here means the ranges couldn't be computed (no base, or the git
    // diff failed). `lines` is only active when we got a concrete range set;
    // otherwise degrade to `files` (report all findings in changed files).
    const changedLineRanges =
      canComputeLines && diffInfo !== null
        ? await getChangedLineRanges({
            directory: resolvedDirectory,
            baseRef: linesBaseRef ?? undefined,
            files: [...diffInfo.changedFiles],
            includeUntracked,
          })
        : null;
    if (scope === "lines" && changedLineRanges === null && !isQuiet) {
      logger.warn(
        "Could not determine changed lines (no base ref or git diff failed); reporting all issues in changed files.",
      );
      logger.break();
    }

    // HACK: set the report-mode marker BEFORE the scan loop runs — if the
    // user hits Ctrl-C mid-scan, the SIGINT handler reads it for the JSON
    // cancel report. Setting it after the loop completes means a cancelled
    // diff scan would report mode: "full".
    setJsonReportMode(baselineRef ? "baseline" : isDiffMode ? "diff" : "full");

    if (isDiffMode && diffInfo && !isQuiet) {
      if (diffInfo.isCurrentChanges) {
        logger.log("Scanning uncommitted changes");
      } else {
        const currentBranchLabel = diffInfo.currentBranch ?? "(detached HEAD)";
        logger.log(
          `Scanning changes: ${highlighter.info(currentBranchLabel)} → ${highlighter.info(diffInfo.baseBranch)}`,
        );
      }
      logger.break();
    }

    const completedScans: CompletedScan[] = [];
    const isMultiProject = projectDirectories.length > 1;

    const scanProject = async (projectDirectory: string): Promise<CompletedScan | null> => {
      // Each selected folder goes through the same scan-target resolution as
      // `diagnose({ projects })` — its own `rootDir`, nested React discovery,
      // and on-disk config (layered additively onto the root config via
      // `mergeReactDoctorConfigs`) — so the CLI and the API agree on what
      // scanning a module means.
      const projectScanTarget =
        projectDirectory === resolvedDirectory
          ? scanTarget
          : await resolveScanTarget(projectDirectory, { allowAmbiguous: true });
      const scanDirectory = projectScanTarget.resolvedDirectory;
      const projectConfig =
        projectDirectory === resolvedDirectory
          ? userConfig
          : mergeReactDoctorConfigs(userConfig, projectScanTarget.userConfig ?? undefined);
      // `plugins` is override-wins in the merge, so relative entries must
      // resolve against the config file that supplied them: the module's own
      // config when it declares `plugins`, the root config otherwise.
      const projectConfigSourceDirectory =
        projectScanTarget.userConfig?.plugins === undefined
          ? scanTarget.configSourceDirectory
          : projectScanTarget.configSourceDirectory;
      // The Socket supply-chain check runs by default; opted out by
      // `--no-supply-chain` (wins) or per-project config. Off ⇒ a manifest-only
      // diff change shouldn't pull a project into the scan (nothing to report).
      const supplyChainEnabled = flags.supplyChain ?? projectConfig?.supplyChain?.enabled !== false;

      let includePaths: string[] | undefined;
      let supplyChainManifestChanged = false;
      const projectBaselineBaseFiles =
        baselineDiffPlan === null
          ? null
          : resolveProjectSourceFilePaths(
              resolvedDirectory,
              scanDirectory,
              baselineDiffPlan.baseFiles,
            );
      const projectBaselineHeadFiles =
        baselineDiffPlan === null
          ? null
          : resolveProjectSourceFilePaths(
              resolvedDirectory,
              scanDirectory,
              baselineDiffPlan.headFiles,
            );
      if (isDiffMode) {
        const changedSourceFiles =
          diffInfo === null
            ? []
            : resolveProjectDiffIncludePaths(resolvedDirectory, scanDirectory, diffInfo);
        // A PR that edits this project's package.json should still have its
        // dependencies scored, even with no changed source files — dependency
        // health is a manifest property, not a per-file one.
        supplyChainManifestChanged =
          supplyChainEnabled &&
          diffInfo !== null &&
          projectManifestChanged(resolvedDirectory, scanDirectory, diffInfo);
        const hasBaselineOnlyFiles = (projectBaselineBaseFiles?.length ?? 0) > 0;
        if (
          changedSourceFiles.length === 0 &&
          !supplyChainManifestChanged &&
          !hasBaselineOnlyFiles
        ) {
          if (!isQuiet) {
            logger.dim(`No changed source files in ${scanDirectory}, skipping.`);
            logger.break();
          }
          return null;
        }
        // A changed package.json enters the scan as an include so the run
        // stays in diff mode (lint ignores it — it's not a source file) while
        // the supply-chain pass runs. Including it also makes the baseline pass
        // materialize the base manifest, so the delta filters out pre-existing
        // low-score dependencies instead of reporting them as newly introduced.
        includePaths = [...changedSourceFiles];
        if (includePaths.length === 0 && hasBaselineOnlyFiles) {
          includePaths.push(...(projectBaselineBaseFiles ?? []));
        }
        if (supplyChainManifestChanged) includePaths.push("package.json");
      }

      if (!isQuiet && !isMultiProject) {
        logger.dim("  ");
      }
      const scanResult = await inspect(scanDirectory, {
        ...scanOptions,
        deadlineEpochMs: scanDeadlineEpochMs,
        includePaths,
        configOverride: projectConfig,
        configSourceDirectory: projectConfigSourceDirectory ?? undefined,
        suppressRendering: isMultiProject,
        // Pool members overlap; they must not own the process-global Sentry
        // run state (see `InspectOptions.concurrentScan`).
        concurrentScan: isMultiProject,
        baseline:
          baselineRef !== null &&
          projectBaselineBaseFiles !== null &&
          projectBaselineHeadFiles !== null
            ? {
                ref: baselineRef,
                baseFiles: projectBaselineBaseFiles,
                headFiles: projectBaselineHeadFiles,
              }
            : undefined,
        changedLineRanges:
          scope === "lines" && changedLineRanges !== null
            ? resolveProjectChangedLineRanges(resolvedDirectory, scanDirectory, changedLineRanges)
            : undefined,
        supplyChainManifestChanged,
      });
      if (!isQuiet && !isMultiProject) {
        logger.break();
      }
      return { directory: scanDirectory, result: scanResult, config: projectConfig };
    };

    // Multi-project scans run through the same bounded pool as
    // `diagnose({ projects })` — per-project rendering is suppressed in favor
    // of the aggregate summary, so concurrent scans don't garble output.
    // Single-project runs keep their inline rendering on the same path.
    const scanLoopStartTime = performance.now();
    const projectCount = projectDirectories.length;
    const batchSpinner =
      isMultiProject && !isQuiet ? spinner(`Scanning ${projectCount} projects…`).start() : null;
    // Concurrent pool members skip the per-scan toggle of the module-level
    // spinner-silent flag (overlapping save/restore pairs would race), so
    // the pool owner silences spinners once around the whole batch.
    const ownsBatchSpinnerSilence = isMultiProject && scanOptions.silent === true;
    const wasSpinnerSilent = isSpinnerSilent();
    if (ownsBatchSpinnerSilence) setSpinnerSilent(true);
    let finishedProjectCount = 0;
    let scanOutcomes: ReadonlyArray<CompletedScan | null>;
    try {
      scanOutcomes = await mapWithConcurrency(
        projectDirectories,
        isMultiProject ? DEFAULT_PROJECT_SCAN_CONCURRENCY : 1,
        async (projectDirectory) => {
          const scanOutcome = await scanProject(projectDirectory);
          finishedProjectCount += 1;
          batchSpinner?.update(
            `Scanning ${projectCount} projects… (${finishedProjectCount}/${projectCount})`,
          );
          return scanOutcome;
        },
      );
    } finally {
      if (ownsBatchSpinnerSilence) setSpinnerSilent(wasSpinnerSilent);
      batchSpinner?.stop();
    }
    for (const scanOutcome of scanOutcomes) {
      if (scanOutcome === null) continue;
      completedScans.push(scanOutcome);
    }

    if (!isQuiet && isMultiProject && completedScans.length > 0) {
      const showShareLink =
        !isShareOptedOut(completedScans, scanOptions.noScore) && !scanOptions.isCi;
      await Effect.runPromise(
        printMultiProjectSummary({
          completedScans,
          categoryFilters,
          verbose: Boolean(flags.verbose),
          outputDirectory: flags.outputDir,
          isOffline: !showShareLink,
          projectName: path.basename(resolvedDirectory),
          totalElapsedMilliseconds: performance.now() - scanLoopStartTime,
        }),
      );
    }

    const surfaceDiagnostics = filterScansForSurface(
      completedScans,
      scanOptions.outputSurface ?? "cli",
    );
    const selectedSurfaceDiagnostics = filterDiagnosticsByCategories(
      surfaceDiagnostics,
      categoryFilters,
    );

    // Single-project scans dump from `inspect()` rendering, and non-quiet
    // monorepo scans from the multi-project summary. Everything else —
    // quiet workspace scans (`--json` / `--score`) and runs where every
    // project was skipped in diff mode — dumps here; quiet runs send the
    // path line to stderr to keep machine-read stdout clean.
    const didScansWriteDump = isMultiProject
      ? !isQuiet && completedScans.length > 0
      : completedScans.length > 0;
    if (flags.outputDir && !didScansWriteDump) {
      await Effect.runPromise(
        printDiagnosticsDump(
          selectedSurfaceDiagnostics,
          flags.outputDir,
          false,
          isQuiet ? "stderr" : "stdout",
        ),
      );
    }

    finalizeScans({
      completedScans,
      // A resolved base ref means a baseline run; finalizeScans downgrades this
      // to `diff` if no delta was produced (degraded run).
      mode: baselineRef ? "baseline" : isDiffMode ? "diff" : "full",
      diff: isDiffMode ? diffInfo : null,
      // Only `changed` intends a baseline. `files` / `lines` have no baseline
      // delta, so they must NOT look "degraded" — that would skip the CI gate
      // they're entitled to.
      baselineIntended: scope === "changed" && diffInfo !== null && !diffInfo.isCurrentChanges,
      isJsonMode,
      isScoreOnly,
      flags,
      categoryFilters,
      userConfig,
      resolvedDirectory,
      startTime,
    });

    // After the results print, offer to hand the issues to a coding agent
    // — an interactive select (no flag). Skipped for quiet, skip-prompts,
    // non-TTY, and agent/CI runs (those get the install hint below).
    const canPromptInteractively =
      !isQuiet && !skipPrompts && process.stdout.isTTY === true && !isCiOrCodingAgentEnvironment();
    if (canPromptInteractively && selectedSurfaceDiagnostics.length > 0) {
      await handoffToAgent({
        diagnostics: selectedSurfaceDiagnostics,
        projectName: path.basename(resolvedDirectory),
        rootDirectory: resolvedDirectory,
        interactive: true,
        outputDirectory: flags.outputDir,
      });
      return;
    }

    const setupProjectRoot = resolveInstallSetupProjectRoot({
      scanRoot: resolvedDirectory,
      scanDirectories: projectDirectories,
    });
    if (setupProjectRoot !== null) {
      const hasCompletedScan = completedScans.length > 0;
      if (
        shouldShowAgentInstallHint({
          projectRoot: setupProjectRoot,
          hasCompletedScan,
          isJsonMode,
          isScoreOnly,
          isStaged: Boolean(flags.staged),
        })
      ) {
        printAgentInstallHint();
        recordCount(METRIC.agentInstallHintShown, 1);
        // Show the install nudge once per repo, then stay quiet — the opt-out
        // store already exists; this wires it so the hint isn't every-scan noise.
        disableSetupPrompt(setupProjectRoot);
      }
    }
  } catch (error) {
    // Expected, user-actionable failures — a directory without React, a missing
    // package.json, or a bad `--diff` base branch — are the user's project or
    // input, not a react-doctor bug: skip Sentry and the "open a prefilled
    // issue" block so they don't become triage noise.
    const isUserError = isExpectedUserError(error);
    const sentryEventId = isUserError ? undefined : await reportErrorToSentry(error);
    // `--debug` prints the run's trace id from the exit handler. A user error
    // skips `reportErrorToSentry` (and its flush), so a trace recorded when the
    // scan span started would never be delivered — flush here so the printed id
    // resolves in Sentry. Cheap no-op for the already-flushed non-user path.
    if (isDebugFlagEnabled()) await flushSentry();
    if (isJsonMode) {
      writeJsonErrorReport(error, sentryEventId);
      process.exitCode = 1;
      return;
    }
    if (isUserError) {
      handleUserError(error);
      return;
    }
    handleError(error, { sentryEventId });
  }
};
