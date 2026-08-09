import * as path from "node:path";
import { performance } from "node:perf_hooks";
import * as Effect from "effect/Effect";
import {
  type ChangedFileLineRanges,
  type DiffInfo,
  getBaselineDiffPlan,
  getChangedLineRanges,
  getDiffInfo,
  highlighter,
  isPathInsideDirectory,
  type JsonReportSkippedProject,
  remainingDeadlineBudgetMs,
  resolveScanTarget,
  toRelativePath,
} from "@react-doctor/core";
import { createInvocationInspect } from "../../inspect.js";
import type { ReactDoctorInspectOptions } from "../../inspect-options.js";
import { flushSentry } from "../../instrument.js";
import { shutdownTelemetry } from "../utils/telemetry-runtime.js";
import type { RequestedScope } from "../utils/resolve-scope.js";
import { cliLogger as logger } from "../utils/cli-logger.js";
import { METRIC } from "../utils/constants.js";
import { recordCount, recordDistribution } from "../utils/record-metric.js";
import type { InspectFlags } from "../utils/inspect-flags.js";
import { filterDiagnosticsByCategories } from "../utils/filter-diagnostics-by-categories.js";
import { deduplicateProjectScans } from "../utils/deduplicate-project-scans.js";
import { collectProjectSourceFileCounts } from "../utils/collect-project-source-file-counts.js";
import { handleError, handleUserError } from "../utils/handle-error.js";
import { isDebugFlagEnabled } from "../utils/is-debug-flag.js";
import { isExpectedUserError } from "../utils/is-expected-user-error.js";
import { handoffToAgent } from "../utils/handoff-to-agent.js";
import { runProjectMigrations } from "../utils/cli-migrations.js";
import {
  enableJsonMode,
  setJsonReportDirectory,
  setJsonReportMode,
  writeJsonErrorReport,
} from "../utils/json-mode.js";
import { reportErrorToSentry } from "../utils/report-error.js";
import { readChangedFilesFrom } from "../utils/read-changed-files-from.js";
import { printCompletedScansHeadless } from "../utils/print-completed-scans-headless.js";
import { printDiagnosticsDump } from "../utils/print-diagnostics-dump.js";
import { isCiOrCodingAgentEnvironment } from "../utils/is-ci-environment.js";
import {
  disableSetupPrompt,
  printAgentInstallHint,
  resolveInstallSetupProjectRoot,
  shouldShowAgentInstallHint,
} from "../utils/prompt-install-setup.js";
import {
  resolveCliInspectOptions,
  type CliInspectOptions,
} from "../utils/resolve-cli-inspect-options.js";
import { finalizeScope, resolveScope, warnDeprecatedDiff } from "../utils/resolve-scope.js";
import { resolveMergeBaseRef } from "../utils/materialize-baseline-files.js";
import { resolveWorkspaceDeadCodeOwner } from "../utils/resolve-workspace-dead-code-owner.js";
import { retryMissingProjectScores } from "../utils/retry-missing-project-scores.js";
import { resolveProjectChangedLineRanges } from "../utils/resolve-project-diff-include-paths.js";
import { resolveProjectScan, type ResolvedProjectScan } from "../utils/resolve-project-scan.js";
import { runExplain } from "../utils/run-explain.js";
import { type ProjectScanOutcome, runProjectScanBatch } from "../utils/run-project-scan-batch.js";
import { buildProjectScanPlan, type ProjectScanPlan } from "../utils/build-project-scan-plan.js";
import { filterScansForSurface } from "../utils/filter-scans-for-surface.js";
import { selectProjects } from "../utils/select-projects.js";
import { resolveProjectRelativeDirectory } from "../utils/resolve-project-relative-directory.js";
import { spinner } from "../utils/spinner.js";
import { shouldSkipPrompts } from "../utils/should-skip-prompts.js";
import { warnDeprecatedFailOn } from "../utils/warn-deprecated-fail-on.js";
import { warnIfAiTrainingEnvironment } from "../utils/warn-ai-training-environment.js";
import { validateIncludeUntrackedScope, validateModeFlags } from "../utils/validate-mode-flags.js";
import { findStagedSnapshotDivergences } from "../utils/find-staged-snapshot-divergences.js";
import { CliInputError } from "../utils/cli-input-error.js";
import {
  type CompletedScan,
  finalizeCliScans,
  reportSkippedProjects,
} from "../utils/finalize-cli-scans.js";
import { runStagedInspect } from "../utils/run-staged-inspect.js";

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

interface ProjectScanExecutionContext {
  readonly flags: InspectFlags;
  readonly resolvedDirectory: string;
  readonly scanOptions: CliInspectOptions;
  readonly inspectProject: ReturnType<typeof createInvocationInspect>;
  readonly scanDeadlineEpochMs: number | undefined;
  readonly baselineDiffPlan: Awaited<ReturnType<typeof getBaselineDiffPlan>>;
  readonly diffInfo: DiffInfo | null;
  readonly isDiffMode: boolean;
  readonly isQuiet: boolean;
  readonly isMultiProject: boolean;
  readonly workspaceDeadCodeOwner: string | null;
  readonly precomputedSourceFileCounts: ReadonlyMap<string, number> | null;
  readonly projectScans: ReadonlyArray<ResolvedProjectScan>;
  readonly baselineRef: string | null;
  readonly scope: RequestedScope["scope"];
  readonly changedLineRanges: ReadonlyArray<ChangedFileLineRanges> | null;
}

interface BuildProjectInspectOptionsInput {
  readonly context: ProjectScanExecutionContext;
  readonly projectScan: ResolvedProjectScan;
  readonly projectScanPlan: ProjectScanPlan;
  readonly ownsWorkspaceDeadCode: boolean;
}

interface IsProjectSupplyChainEnabledInput {
  readonly flags: InspectFlags;
  readonly projectConfig: ResolvedProjectScan["config"];
}

interface RunConfiguredProjectScanInput {
  readonly context: ProjectScanExecutionContext;
  readonly projectScan: ResolvedProjectScan;
}

const hasScanDeadlineExpired = (scanDeadlineEpochMs: number | undefined): boolean =>
  scanDeadlineEpochMs !== undefined && remainingDeadlineBudgetMs(scanDeadlineEpochMs) === 0;

const isProjectSupplyChainEnabled = ({
  flags,
  projectConfig,
}: IsProjectSupplyChainEnabledInput): boolean =>
  flags.supplyChain ?? projectConfig?.supplyChain?.enabled !== false;

const buildProjectInspectOptions = ({
  context,
  projectScan,
  projectScanPlan,
  ownsWorkspaceDeadCode,
}: BuildProjectInspectOptionsInput): ReactDoctorInspectOptions => {
  const scanDirectory = projectScan.directory;
  return {
    ...context.scanOptions,
    deadCode:
      context.workspaceDeadCodeOwner === null
        ? context.scanOptions.deadCode
        : ownsWorkspaceDeadCode,
    precomputedSourceFileCount: context.precomputedSourceFileCounts?.get(scanDirectory),
    deadlineEpochMs: context.scanDeadlineEpochMs,
    includePaths: projectScanPlan.includePaths,
    configOverride: projectScan.config,
    configSourceDirectory: projectScan.configSourceDirectory ?? undefined,
    suppressRendering: context.isMultiProject,
    concurrentScan: context.isMultiProject,
    excludedProjectDirectories: context.projectScans
      .filter((candidateProjectScan) =>
        isPathInsideDirectory(candidateProjectScan.directory, scanDirectory),
      )
      .map((candidateProjectScan) => candidateProjectScan.directory),
    retainExcludedProjectDeadCodeDiagnostics: ownsWorkspaceDeadCode,
    baseline:
      context.baselineRef !== null &&
      projectScanPlan.projectBaselineBaseFiles !== null &&
      projectScanPlan.projectBaselineHeadFiles !== null
        ? {
            ref: context.baselineRef,
            baseFiles: projectScanPlan.projectBaselineBaseFiles,
            headFiles: projectScanPlan.projectBaselineHeadFiles,
          }
        : undefined,
    changedLineRanges:
      context.scope === "lines" && context.changedLineRanges !== null
        ? resolveProjectChangedLineRanges(
            context.resolvedDirectory,
            scanDirectory,
            context.changedLineRanges,
          )
        : undefined,
    supplyChainManifestChanged: projectScanPlan.supplyChainManifestChanged,
  };
};

const runConfiguredProjectScan = async ({
  context,
  projectScan,
}: RunConfiguredProjectScanInput): Promise<
  ProjectScanOutcome<CompletedScan, JsonReportSkippedProject>
> => {
  if (hasScanDeadlineExpired(context.scanDeadlineEpochMs)) {
    return {
      status: "skipped",
      value: { directory: projectScan.directory, reason: "max-duration" },
    };
  }

  const scanDirectory = projectScan.directory;
  const projectConfig = projectScan.config;
  const ownsWorkspaceDeadCode = scanDirectory === context.workspaceDeadCodeOwner;
  const supplyChainEnabled = isProjectSupplyChainEnabled({
    flags: context.flags,
    projectConfig,
  });
  const projectScanPlan = buildProjectScanPlan({
    rootDirectory: context.resolvedDirectory,
    projectDirectory: scanDirectory,
    baselineDiffPlan: context.baselineDiffPlan,
    diffInfo: context.diffInfo,
    isDiffMode: context.isDiffMode,
    supplyChainEnabled,
  });
  if (projectScanPlan.shouldSkipProject) {
    if (!context.isQuiet) {
      logger.dim(`No changed source files in ${scanDirectory}, skipping.`);
      logger.break();
    }
    return { status: "omitted" };
  }

  if (!context.isQuiet && !context.isMultiProject) logger.dim("  ");
  const scanResult = await context.inspectProject(
    scanDirectory,
    buildProjectInspectOptions({ context, projectScan, projectScanPlan, ownsWorkspaceDeadCode }),
  );
  if (!context.isQuiet && !context.isMultiProject) logger.break();
  return {
    status: "completed",
    value: { directory: scanDirectory, result: scanResult, config: projectConfig },
  };
};

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
  let scanStartupSpinner: ReturnType<ReturnType<typeof spinner>["start"]> | null = null;

  try {
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

    const scanOptions: CliInspectOptions = resolveCliInspectOptions(flags, userConfig);
    const inspectProject = createInvocationInspect(scanOptions.concurrency);
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
      await runStagedInspect({
        flags,
        scanTarget,
        scanOptions,
        inspectProject,
        scanDeadlineEpochMs,
        categoryFilters,
        isQuiet,
        isJsonMode,
        isScoreOnly,
        startTime,
      });
      return;
    }
    const projectDirectories = await selectProjects(
      resolvedDirectory,
      flags.project,
      skipPrompts,
      userConfig?.projects,
    );
    const projectSelectionCompletedTime = performance.now();
    let changedFilesDiffInfo = flags.changedFilesFrom
      ? buildChangedFilesDiffInfo(readChangedFilesFrom(path.resolve(flags.changedFilesFrom)))
      : null;
    if (changedFilesDiffInfo !== null && scanTarget.didRedirectViaRootDir) {
      const relativeProjectDirectory = resolveProjectRelativeDirectory(
        requestedDirectory,
        resolvedDirectory,
      );
      if (relativeProjectDirectory) {
        const projectPrefix = `${relativeProjectDirectory}/`;
        changedFilesDiffInfo = {
          ...changedFilesDiffInfo,
          changedFiles: changedFilesDiffInfo.changedFiles.flatMap((filePath) => {
            return filePath.startsWith(projectPrefix) ? [filePath.slice(projectPrefix.length)] : [];
          }),
        };
      }
    }
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
    scanStartupSpinner = !isQuiet ? spinner("Scanning...").start() : null;
    if (scanStartupSpinner !== null) {
      recordDistribution(
        METRIC.scanFeedbackDelay,
        performance.now() - projectSelectionCompletedTime,
        {
          unit: "millisecond",
        },
      );
    }
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
    scanStartupSpinner?.stop();
    scanStartupSpinner = null;
    const scope = await finalizeScope({
      requested: scopeRequest,
      diffInfo,
      skipPrompts,
      isQuiet,
    });
    scanStartupSpinner = !isQuiet ? spinner("Scanning...").start() : null;
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
    scanStartupSpinner?.stop();
    scanStartupSpinner = null;
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

    const projectScans = deduplicateProjectScans(
      await Promise.all(
        projectDirectories.map((projectDirectory) =>
          resolveProjectScan(scanTarget, projectDirectory),
        ),
      ),
    );
    const isMultiProject = projectScans.length > 1;
    const rootProjectScan = projectScans.find(
      (projectScan) => path.resolve(projectScan.directory) === path.resolve(resolvedDirectory),
    );
    const workspaceDeadCodeOwner = resolveWorkspaceDeadCodeOwner({
      rootDirectory: resolvedDirectory,
      projectDirectories: projectScans.map((projectScan) => projectScan.directory),
      isRootDeadCodeEnabled: scanOptions.deadCode ?? rootProjectScan?.config?.deadCode ?? true,
    });
    if (workspaceDeadCodeOwner !== null) {
      recordCount(METRIC.scanWorkspaceDeadCodeShared, 1, { projectCount: projectScans.length });
    }
    const precomputedSourceFileCounts =
      isMultiProject && !isDiffMode
        ? await collectProjectSourceFileCounts(
            resolvedDirectory,
            projectScans.map((projectScan) => projectScan.directory),
          )
        : null;
    const projectScanExecutionContext: ProjectScanExecutionContext = {
      flags,
      resolvedDirectory,
      scanOptions,
      inspectProject,
      scanDeadlineEpochMs,
      baselineDiffPlan,
      diffInfo,
      isDiffMode,
      isQuiet,
      isMultiProject,
      workspaceDeadCodeOwner,
      precomputedSourceFileCounts,
      projectScans,
      baselineRef,
      scope,
      changedLineRanges,
    };

    const projectBatch = await runProjectScanBatch({
      projects: projectScans,
      isQuiet,
      isSilent: scanOptions.silent === true,
      scanProject: (projectScan) =>
        runConfiguredProjectScan({ context: projectScanExecutionContext, projectScan }),
    });
    const completedScans = await retryMissingProjectScores(
      projectBatch.completedScans.map((completedScan) => ({
        ...completedScan,
        isScoreDisabled: scanOptions.noScore ?? completedScan.config?.noScore ?? false,
      })),
    );
    const skippedProjects = projectBatch.skippedScans;
    reportSkippedProjects({ skippedProjects, isQuiet });

    if (!isQuiet && isMultiProject && completedScans.length > 0) {
      await Effect.runPromise(
        printCompletedScansHeadless({
          categoryFilters,
          completedScans,
          elapsedMilliseconds: projectBatch.elapsedMilliseconds,
          noScoreMessage: "Score unavailable.",
          outputDirectory: flags.outputDir,
          outputSurface: scanOptions.outputSurface ?? "cli",
          projectName: path.basename(resolvedDirectory),
          verbose: Boolean(flags.verbose),
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

    // Single-project scans dump from `inspect()`, and non-quiet workspace
    // scans from the aggregate headless report. Everything else —
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

    finalizeCliScans({
      completedScans,
      skippedProjects,
      // A resolved base ref means a baseline run; finalization downgrades this
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
    scanStartupSpinner?.stop();
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
    if (isDebugFlagEnabled()) await Promise.all([flushSentry(), shutdownTelemetry()]);
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
