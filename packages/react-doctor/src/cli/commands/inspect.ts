import { tmpdir } from "node:os";
import * as path from "node:path";
import { performance } from "node:perf_hooks";
import * as Effect from "effect/Effect";
import * as fs from "node:fs";
import {
  buildJsonReport,
  collectSupplyChainScores,
  filterDiagnosticsForSurface,
  findLegacyConfig,
  getDiffInfo,
  highlighter,
  resolveScanTarget,
  toRelativePath,
} from "@react-doctor/core";
import { inspect } from "../../inspect.js";
import type {
  Diagnostic,
  DiffInfo,
  InspectResult,
  JsonReportMode,
  ReactDoctorConfig,
} from "@react-doctor/core";
import { cliLogger as logger } from "../utils/cli-logger.js";
import { METRIC, STAGED_FILES_TEMP_DIR_PREFIX } from "../utils/constants.js";
import { recordCount } from "../utils/record-metric.js";
import { getStagedSourceFiles, materializeStagedFiles } from "../utils/get-staged-files.js";
import type { InspectFlags } from "../utils/inspect-flags.js";
import { filterDiagnosticsByCategories } from "../utils/filter-diagnostics-by-categories.js";
import { handleError, handleUserError } from "../utils/handle-error.js";
import { isExpectedUserError } from "../utils/is-expected-user-error.js";
import { handoffToAgent } from "../utils/handoff-to-agent.js";
import { migrateLegacyConfig } from "../utils/migrate-legacy-config.js";
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
import { isCiOrCodingAgentEnvironment } from "../utils/is-ci-environment.js";
import {
  printAgentInstallHint,
  resolveInstallSetupProjectRoot,
  shouldShowAgentInstallHint,
} from "../utils/prompt-install-setup.js";
import { resolveCliInspectOptions } from "../utils/resolve-cli-inspect-options.js";
import type { CliInspectOptions } from "../utils/resolve-cli-inspect-options.js";
import { resolveDiffMode } from "../utils/resolve-diff-mode.js";
import { resolveEffectiveDiff } from "../utils/resolve-effective-diff.js";
import { resolveMergeBaseRef } from "../utils/materialize-baseline-files.js";
import { resolveBlockingLevel } from "../utils/resolve-blocking-level.js";
import { resolveProjectDiffIncludePaths } from "../utils/resolve-project-diff-include-paths.js";
import { runExplain } from "../utils/run-explain.js";
import { projectManifestChanged } from "../utils/project-manifest-changed.js";
import { renderSupplyChainScores } from "../utils/render-supply-chain-scores.js";
import { selectProjects } from "../utils/select-projects.js";
import { spinner } from "../utils/spinner.js";
import { shouldBlockCi } from "../utils/should-block-ci.js";
import { shouldSkipPrompts } from "../utils/should-skip-prompts.js";
import { warnDeprecatedFailOn } from "../utils/warn-deprecated-fail-on.js";
import { validateModeFlags } from "../utils/validate-mode-flags.js";
import { VERSION } from "../utils/version.js";

interface CompletedScan {
  directory: string;
  result: InspectResult;
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
  readonly diagnostics: Diagnostic[];
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
 * and set `process.exitCode = 1` when a diagnostic at or above the
 * `--blocking` threshold (default `"error"`) reaches the `ciFailure`
 * surface. `--blocking none` keeps the scan advisory (always exits 0).
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
      }),
    );
  }

  if (input.isScoreOnly || baselineDegraded) return;

  const ciFailureDiagnostics = filterDiagnosticsForSurface(
    input.diagnostics,
    "ciFailure",
    input.userConfig,
  );
  if (shouldBlockCi(ciFailureDiagnostics, resolveBlockingLevel(input.flags, input.userConfig))) {
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
const maybeMigrateLegacyConfig = (
  requestedDirectory: string,
  { isQuiet, isStaged }: MigrationGuardInput,
): void => {
  const isInteractiveHumanRun =
    !isQuiet && !isStaged && process.stdout.isTTY === true && !isCiOrCodingAgentEnvironment();
  if (!isInteractiveHumanRun) return;

  const legacyConfig = findLegacyConfig(requestedDirectory);
  if (!legacyConfig) return;

  const migratedPath = migrateLegacyConfig(legacyConfig);
  if (!migratedPath) return;

  logger.success("Migrated react-doctor.config.json → doctor.config.ts");
  logger.dim(
    `  Your settings were preserved. Review ${toRelativePath(migratedPath, requestedDirectory)} and commit it.`,
  );
  logger.break();
};

export const inspectAction = async (directory: string, flags: InspectFlags): Promise<void> => {
  const isScoreOnly = Boolean(flags.score);
  const isJsonMode = Boolean(flags.json);
  const isQuiet = isScoreOnly || isJsonMode;
  const requestedDirectory = path.resolve(directory);
  const startTime = performance.now();

  if (isJsonMode) {
    enableJsonMode({ compact: Boolean(flags.jsonCompact), directory: requestedDirectory });
  }
  // Recorded after JSON mode is enabled so the metric's run attributes reflect
  // the true `jsonMode` (run context is rebuilt per emit in `record-metric.ts`).
  recordCount(METRIC.cliInvoked, 1, { command: "inspect" });

  try {
    validateModeFlags(flags);

    maybeMigrateLegacyConfig(requestedDirectory, { isQuiet, isStaged: Boolean(flags.staged) });

    const scanTarget = await resolveScanTarget(requestedDirectory, { allowAmbiguous: true });
    const userConfig = scanTarget.userConfig;
    const resolvedDirectory = scanTarget.resolvedDirectory;
    setJsonReportDirectory(resolvedDirectory);
    warnDeprecatedFailOn(flags, userConfig);
    if (scanTarget.didRedirectViaRootDir && !isQuiet) {
      logger.dim(
        `Redirected to ${highlighter.info(toRelativePath(resolvedDirectory, requestedDirectory))} via react-doctor config "rootDir".`,
      );
      logger.break();
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

    // `--sfw` is a standalone demo: print the Socket.dev supply-chain score of
    // every direct dependency, then exit without running the usual scan.
    if (flags.sfw) {
      const sfwSpinner = spinner("Scoring dependencies against Socket.dev…").start();
      const scores = await Effect.runPromise(
        collectSupplyChainScores({ rootDirectory: resolvedDirectory, userConfig }),
      );
      sfwSpinner.stop();
      logger.break();
      logger.log(renderSupplyChainScores(scores));
      logger.break();
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
    const categoryFilters = new Set(scanOptions.categoryFilters ?? []);
    const skipPrompts = shouldSkipPrompts({ yes: flags.yes, json: flags.json });

    if (flags.staged) {
      setJsonReportMode("staged");
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
      try {
        const scanResult = await inspect(snapshot.tempDirectory, {
          ...scanOptions,
          includePaths: snapshot.stagedFiles,
          configOverride: userConfig,
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
          diagnostics: remappedDiagnostics,
          completedScans: [{ directory: resolvedDirectory, result: remappedInspectResult }],
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

    const projectDirectories = await selectProjects(resolvedDirectory, flags.project, skipPrompts);

    const changedFilesDiffInfo = flags.changedFilesFrom
      ? buildChangedFilesDiffInfo(readChangedFilesFrom(path.resolve(flags.changedFilesFrom)))
      : null;
    const effectiveDiff = resolveEffectiveDiff(flags, userConfig);
    const explicitBaseBranch = typeof effectiveDiff === "string" ? effectiveDiff : undefined;
    const wantsDiffMode = effectiveDiff !== undefined && effectiveDiff !== false;
    // HACK: also call getDiffInfo when we MIGHT prompt the user — without
    // it, resolveDiffMode short-circuits at !diffInfo and the
    // "Only scan changed files?" prompt never appears for users on a
    // feature branch who didn't explicitly pass --diff.
    const shouldDetectDiff =
      changedFilesDiffInfo === null && (wantsDiffMode || (!skipPrompts && !isQuiet));
    const diffInfo =
      changedFilesDiffInfo ??
      (shouldDetectDiff ? await getDiffInfo(resolvedDirectory, explicitBaseBranch) : null);
    const isDiffMode =
      changedFilesDiffInfo !== null ||
      (await resolveDiffMode(diffInfo, effectiveDiff, skipPrompts, isQuiet));

    // Baseline (PR-introduced-issues-only) mode: when diffing against a base
    // ref (not just uncommitted changes), read base content from the SAME
    // commit the file diff was taken against so the file set and the base
    // snapshot agree. The GitHub Action forwards the PR base SHA — three-dot
    // PR semantics, so merge-base it with HEAD; a local `--diff` already knows
    // its exact base (`diffBaseRef`: `A` for two-dot `A..B`, the merge-base for
    // three-dot / single-base). A null ref (base not fetched, detached, or git
    // unavailable) degrades to a plain diff scan that shows all findings.
    const baselineRef =
      isDiffMode && diffInfo && !diffInfo.isCurrentChanges
        ? diffInfo.baseSha
          ? await resolveMergeBaseRef(resolvedDirectory, diffInfo.baseSha)
          : (diffInfo.diffBaseRef ??
            (await resolveMergeBaseRef(resolvedDirectory, diffInfo.baseBranch)))
        : null;

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

    const allDiagnostics: Diagnostic[] = [];
    const completedScans: Array<{ directory: string; result: InspectResult }> = [];
    const isMultiProject = projectDirectories.length > 1;
    // The Socket supply-chain check runs by default; opted out per project
    // config. Off ⇒ a manifest-only diff change shouldn't pull a project into
    // the scan (there'd be nothing to report).
    const supplyChainEnabled = userConfig?.supplyChain?.enabled !== false;

    for (const projectDirectory of projectDirectories) {
      let includePaths: string[] | undefined;
      let supplyChainManifestChanged = false;
      if (isDiffMode) {
        const changedSourceFiles =
          diffInfo === null
            ? []
            : resolveProjectDiffIncludePaths(resolvedDirectory, projectDirectory, diffInfo);
        // A PR that edits this project's package.json should still have its
        // dependencies scored, even with no changed source files — dependency
        // health is a manifest property, not a per-file one.
        supplyChainManifestChanged =
          supplyChainEnabled &&
          diffInfo !== null &&
          projectManifestChanged(resolvedDirectory, projectDirectory, diffInfo);
        if (changedSourceFiles.length === 0 && !supplyChainManifestChanged) {
          if (!isQuiet) {
            logger.dim(`No changed source files in ${projectDirectory}, skipping.`);
            logger.break();
          }
          continue;
        }
        // A changed package.json enters the scan as an include so the run
        // stays in diff mode (lint ignores it — it's not a source file) while
        // the supply-chain pass runs. Including it also makes the baseline pass
        // materialize the base manifest, so the delta filters out pre-existing
        // low-score dependencies instead of reporting them as newly introduced.
        includePaths = [...changedSourceFiles];
        if (supplyChainManifestChanged) includePaths.push("package.json");
      }

      if (!isQuiet && !isMultiProject) {
        logger.dim("  ");
      }
      const scanResult = await inspect(projectDirectory, {
        ...scanOptions,
        includePaths,
        configOverride: userConfig,
        suppressRendering: isMultiProject,
        baseline: baselineRef ? { ref: baselineRef } : undefined,
        supplyChainManifestChanged,
      });
      allDiagnostics.push(...scanResult.diagnostics);
      completedScans.push({ directory: projectDirectory, result: scanResult });
      if (!isQuiet && !isMultiProject) {
        logger.break();
      }
    }

    if (!isQuiet && isMultiProject && completedScans.length > 0) {
      const shouldShowShareLink =
        !scanOptions.noScore && (userConfig?.share ?? true) && !scanOptions.isCi;
      await Effect.runPromise(
        printMultiProjectSummary({
          completedScans,
          categoryFilters,
          userConfig,
          verbose: Boolean(flags.verbose),
          isOffline: !shouldShowShareLink,
          projectName: path.basename(resolvedDirectory),
        }),
      );
    }

    finalizeScans({
      diagnostics: allDiagnostics,
      completedScans,
      // A resolved base ref means a baseline run; finalizeScans downgrades this
      // to `diff` if no delta was produced (degraded run).
      mode: baselineRef ? "baseline" : isDiffMode ? "diff" : "full",
      diff: isDiffMode ? diffInfo : null,
      baselineIntended: isDiffMode && diffInfo !== null && !diffInfo.isCurrentChanges,
      isJsonMode,
      isScoreOnly,
      flags,
      categoryFilters,
      userConfig,
      resolvedDirectory,
      startTime,
    });

    const surfaceDiagnostics = filterDiagnosticsForSurface(
      allDiagnostics,
      scanOptions.outputSurface ?? "cli",
      userConfig,
    );
    const selectedSurfaceDiagnostics = filterDiagnosticsByCategories(
      surfaceDiagnostics,
      categoryFilters,
    );

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
      }
    }
  } catch (error) {
    // Expected, user-actionable failures — a directory without React, a missing
    // package.json, or a bad `--diff` base branch — are the user's project or
    // input, not a react-doctor bug: skip Sentry and the "open a prefilled
    // issue" block so they don't become triage noise.
    const isUserError = isExpectedUserError(error);
    const sentryEventId = isUserError ? undefined : await reportErrorToSentry(error);
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
