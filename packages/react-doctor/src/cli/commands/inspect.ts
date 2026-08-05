import { tmpdir } from "node:os";
import * as path from "node:path";
import { performance } from "node:perf_hooks";
import * as Effect from "effect/Effect";
import * as fs from "node:fs";
import {
  buildJsonReport,
  type DiffInfo,
  getBaselineDiffPlan,
  getChangedLineRanges,
  getDiffInfo,
  hasReactRuntime,
  highlighter,
  type InspectResult,
  isPathInsideDirectory,
  type JsonReportMode,
  type ReactDoctorConfig,
  remainingDeadlineBudgetMs,
  resolveScanTarget,
  toRelativePath,
} from "@react-doctor/core";
import { createInvocationInspect } from "../../inspect.js";
import { flushSentry } from "../../instrument.js";
import type { JsonReportSkippedProject } from "@react-doctor/core";
import type { RequestedScope } from "../utils/resolve-scope.js";
import { cliLogger as logger } from "../utils/cli-logger.js";
import { METRIC, STAGED_FILES_TEMP_DIR_PREFIX } from "../utils/constants.js";
import { recordCount, recordDistribution } from "../utils/record-metric.js";
import { getStagedSourceFiles, materializeStagedFiles } from "../utils/get-staged-files.js";
import type { InspectFlags } from "../utils/inspect-flags.js";
import { filterDiagnosticsByCategories } from "../utils/filter-diagnostics-by-categories.js";
import { deduplicateProjectScans } from "../utils/deduplicate-project-scans.js";
import { collectProjectSourceFileCounts } from "../utils/collect-project-source-file-counts.js";
import { formatSkippedProjectsMessage } from "../utils/format-skipped-projects-message.js";
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
  writeJsonReport,
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
import { resolveBlockingLevel } from "../utils/resolve-blocking-level.js";
import { resolveWorkspaceDeadCodeOwner } from "../utils/resolve-workspace-dead-code-owner.js";
import { retryMissingProjectScores } from "../utils/retry-missing-project-scores.js";
import {
  resolveProjectChangedLineRanges,
  resolveProjectDiffIncludePaths,
} from "../utils/resolve-project-diff-include-paths.js";
import { resolveProjectSourceFilePaths } from "../utils/resolve-project-source-file-paths.js";
import { resolveProjectScan, type ResolvedProjectScan } from "../utils/resolve-project-scan.js";
import { runExplain } from "../utils/run-explain.js";
import { runProjectScanBatch } from "../utils/run-project-scan-batch.js";
import { projectManifestChanged } from "../utils/project-manifest-changed.js";
import { filterScansForSurface } from "../utils/filter-scans-for-surface.js";
import { selectProjects } from "../utils/select-projects.js";
import {
  STAGED_PROJECT_FALLBACK_HINT,
  selectStagedProjects,
} from "../utils/select-staged-projects.js";
import { resolveProjectRelativeDirectory } from "../utils/resolve-project-relative-directory.js";
import { spinner } from "../utils/spinner.js";
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

interface StagedProjectScanContext {
  readonly projectDirectory: string;
  readonly scanDirectory: string;
  /** `scanDirectory` relative to the scan root; empty when they're the same. */
  readonly treeRelativeDirectory: string;
  readonly projectConfig: ReactDoctorConfig | null;
  readonly projectConfigSourceDirectory: string | null;
}

interface StagedProjectScan extends StagedProjectScanContext {
  /**
   * The staged paths this project owns, relative to the **scan root** (the
   * space `git diff --cached --relative` reports and the snapshot mirrors).
   * Each staged path belongs to exactly one project, so nested packages never
   * scan the same file twice.
   */
  readonly stagedFiles: ReadonlyArray<string>;
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
  readonly skippedProjects: ReadonlyArray<JsonReportSkippedProject>;
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

interface ReportSkippedProjectsInput {
  readonly skippedProjects: JsonReportSkippedProject[];
  readonly isQuiet: boolean;
}

const reportSkippedProjects = (input: ReportSkippedProjectsInput): void => {
  input.skippedProjects.sort((left, right) => left.directory.localeCompare(right.directory));
  if (input.skippedProjects.length === 0) return;

  recordCount(METRIC.scanProjectSkipped, input.skippedProjects.length, {
    reason: "max-duration",
  });
  if (!input.isQuiet) {
    logger.warn(formatSkippedProjectsMessage(input.skippedProjects.length));
    logger.break();
  }
};

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
    input.skippedProjects.length === 0 &&
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
        skippedProjects: input.skippedProjects,
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
      // `--staged` scans the index. `--project`, or `doctor.config`'s
      // `projects`, names the packages that own the staged paths, so each one
      // materializes its own config and keeps its React identity. With neither,
      // one scan at the scan root.
      const hasConfigProjects = (userConfig?.projects ?? []).some(
        (projectName) => projectName.trim().length > 0,
      );
      // `projects` entries resolve against the scan root, not the directory that
      // declared them, so they only apply when react-doctor was invoked from the
      // config's own directory. Without this a per-package or positional run
      // would resolve an ancestor config's entries against the package.
      const configProjectsApply =
        hasConfigProjects && scanTarget.requestedDirectory === scanTarget.configSourceDirectory;
      const projectDirectories = await selectStagedProjects({
        rootDirectory: resolvedDirectory,
        projectFlag: flags.project,
        configProjects: configProjectsApply ? userConfig?.projects : undefined,
      });

      // Nothing to scan is not a failure: `--staged` is wired into commit hooks
      // and `lint-staged`, so it must not fail a commit that stages no source.
      const reportNothingToScan = (input: {
        readonly reason: string;
        readonly severity?: "dim" | "warn";
      }): void => {
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
          if (input.severity === "warn") {
            logger.warn(input.reason);
            logger.break();
          } else {
            logger.dim(input.reason);
          }
        }
      };

      const rootStagedFiles = await getStagedSourceFiles(resolvedDirectory);
      if (rootStagedFiles.length === 0) {
        reportNothingToScan({ reason: "No staged source files found." });
        return;
      }

      const buildProjectScanContext = async (
        projectDirectory: string,
      ): Promise<StagedProjectScanContext | null> => {
        const projectScan = await resolveProjectScan(scanTarget, projectDirectory);
        const scanDirectory = projectScan.directory;
        const treeRelativeDirectory = resolveProjectRelativeDirectory(
          resolvedDirectory,
          scanDirectory,
        );
        // A project outside the scan root owns none of the index paths — the
        // index is keyed to the root, so there is nothing for it to scan.
        if (treeRelativeDirectory === null) return null;
        return {
          projectDirectory,
          scanDirectory,
          treeRelativeDirectory,
          projectConfig: projectScan.config,
          projectConfigSourceDirectory: projectScan.configSourceDirectory,
        };
      };

      const projectScanContexts: StagedProjectScanContext[] = [];
      const seenScanDirectories = new Set<string>();
      for (const projectDirectory of projectDirectories) {
        const projectScanContext = await buildProjectScanContext(projectDirectory);
        if (projectScanContext === null) {
          // An explicit `--project` naming an outside directory is a mistake
          // worth failing on; a config entry falls back with the others below.
          if (flags.project) {
            throw new CliInputError(
              `Project "${toRelativePath(projectDirectory, resolvedDirectory)}" is outside ${resolvedDirectory}, so it holds none of the staged files. Run --staged from a directory that contains the project.`,
            );
          }
          continue;
        }
        // Two entries can name one directory — as spellings of the same package,
        // or via a `rootDir` redirect onto a shared target. Scanning it twice
        // doubles its diagnostics into the summary, the report, and the gate.
        if (seenScanDirectories.has(projectScanContext.scanDirectory)) continue;
        seenScanDirectories.add(projectScanContext.scanDirectory);
        projectScanContexts.push(projectScanContext);
      }

      // Every configured project resolved outside the scan root, so none of them
      // can own an index path. Falling through would scan nothing and report
      // "no staged files in the selected projects" — a clean gate for a reason
      // that is really a misconfiguration. Warn and scan the root instead, the
      // same way an unresolvable entry does.
      if (projectScanContexts.length === 0) {
        logger.warn(
          `No configured project is inside ${resolvedDirectory}. ${STAGED_PROJECT_FALLBACK_HINT}`,
        );
        logger.break();
        const rootScanContext = await buildProjectScanContext(resolvedDirectory);
        if (rootScanContext !== null) projectScanContexts.push(rootScanContext);
      }

      // Assign each staged path to exactly one project, deepest first, so a
      // nested package claims its own files before its parent does.
      // Among the ancestors of one staged path, a longer tree-relative directory
      // is always the deeper one.
      const contextsByLongestPathFirst = [...projectScanContexts].sort(
        (left, right) => right.treeRelativeDirectory.length - left.treeRelativeDirectory.length,
      );
      const ownedStagedFiles = new Map<string, string[]>();
      for (const stagedFile of rootStagedFiles) {
        const owner = contextsByLongestPathFirst.find(
          (context) =>
            context.treeRelativeDirectory.length === 0 ||
            stagedFile.startsWith(`${context.treeRelativeDirectory}/`),
        );
        if (owner === undefined) continue;
        const ownedFiles = ownedStagedFiles.get(owner.scanDirectory);
        if (ownedFiles === undefined) ownedStagedFiles.set(owner.scanDirectory, [stagedFile]);
        else ownedFiles.push(stagedFile);
      }

      const stagedProjectScans: StagedProjectScan[] = [];
      for (const projectScanContext of projectScanContexts) {
        const projectStagedFiles = ownedStagedFiles.get(projectScanContext.scanDirectory);
        if (projectStagedFiles === undefined) continue;
        stagedProjectScans.push({ ...projectScanContext, stagedFiles: projectStagedFiles });
      }

      if (stagedProjectScans.length === 0) {
        reportNothingToScan({ reason: "No staged source files in the selected projects." });
        return;
      }

      // Ownership is exclusive, so this is already duplicate-free. Everything
      // downstream works from it rather than the whole index: `showStagedContent`
      // spawns one `git show` per file, so an unowned path would cost a
      // subprocess to write bytes no scan reads.
      const selectedStagedFiles = stagedProjectScans.flatMap(
        (projectScan) => projectScan.stagedFiles,
      );
      const stagedFileCount = selectedStagedFiles.length;
      const unselectedStagedFileCount = rootStagedFiles.length - stagedFileCount;
      if (!isQuiet) {
        logger.log(`Scanning ${highlighter.info(`${stagedFileCount}`)} staged files...`);
        // Staged paths outside the selected projects are out of scope, not
        // missed — a plain scan would skip them too. Say so anyway, so the
        // count above can't read as the whole staged set.
        if (unselectedStagedFileCount > 0) {
          logger.dim(
            `${unselectedStagedFileCount} more staged file${unselectedStagedFileCount === 1 ? "" : "s"} outside the selected projects.`,
          );
        }
        logger.break();
      }

      // `--staged --scope lines`: only report issues on the staged hunks. Ranges
      // are computed once at the scan root (repo-relative paths), then re-keyed
      // per project so they match project-relative diagnostic paths. A `null`
      // result (git diff failed) degrades to file-level rather than hiding
      // everything behind an empty filter.
      const stagedWantsLines = resolveScope(flags, userConfig).scope === "lines";
      const stagedLineRanges = stagedWantsLines
        ? await getChangedLineRanges({
            directory: resolvedDirectory,
            cached: true,
            files: selectedStagedFiles,
          })
        : null;
      if (stagedWantsLines && stagedLineRanges === null && !isQuiet) {
        logger.warn(
          "Could not determine staged changed lines; reporting all issues in staged files.",
        );
        logger.break();
      }
      // Every run that scans a package rather than the scan root, whether it
      // selected one or several — a single selected package is the whole feature
      // working, so gating this on more than one would hide the common case.
      if (stagedProjectScans.some((projectScan) => projectScan.treeRelativeDirectory.length > 0)) {
        recordCount(METRIC.stagedPerProject, 1, { projectCount: stagedProjectScans.length });
      }
      const tempDirectory = fs.mkdtempSync(path.join(tmpdir(), STAGED_FILES_TEMP_DIR_PREFIX));
      const configSubdirectories = new Set<string>();
      for (const projectScan of stagedProjectScans) {
        configSubdirectories.add(projectScan.treeRelativeDirectory);
        const projectRelativeDirectory = resolveProjectRelativeDirectory(
          resolvedDirectory,
          projectScan.projectDirectory,
        );
        if (projectRelativeDirectory !== null) {
          configSubdirectories.add(projectRelativeDirectory);
        }
      }
      // If materialization throws before `snapshot.cleanup` is wired up, remove
      // the temp dir we just created so it can't leak.
      const snapshot = await materializeStagedFiles({
        directory: resolvedDirectory,
        stagedFiles: selectedStagedFiles,
        tempDirectory,
        configSubdirectories: [...configSubdirectories],
      }).catch((error: unknown) => {
        fs.rmSync(tempDirectory, { recursive: true, force: true });
        throw error;
      });
      const materializedStagedFiles = new Set(snapshot.stagedFiles);
      // A project whose own staged files could not be snapshotted is dropped,
      // not failed — see the empty case below for why none of the causes may
      // block a commit.
      const stagedProjectRuns = stagedProjectScans
        .map((projectScan) => ({
          projectScan,
          includePaths: resolveProjectSourceFilePaths(
            resolvedDirectory,
            projectScan.scanDirectory,
            projectScan.stagedFiles.filter((stagedFile) => materializedStagedFiles.has(stagedFile)),
          ),
        }))
        .filter((projectRun) => projectRun.includePaths.length > 0);
      // Derived from the projects that survived the drop above, not the ones
      // selected: a lone survivor renders inline like any single-project scan
      // instead of being suppressed in favour of an aggregate summary of one.
      const isMultiProject = stagedProjectRuns.length > 1;
      const skippedProjects: JsonReportSkippedProject[] = [];
      // Nothing at all came out of the index. An unreadable index already failed
      // upstream — the divergence guard runs `git status` before any of this, and
      // `getStagedSourceFiles` throws when `git diff --cached` reports failure —
      // so what is left here is an oversized blob (`GIT_SHOW_MAX_BUFFER_BYTES`),
      // a transient `git show` failure, or a path the snapshot refused. The
      // committer can act on none of them, and failing would only teach them to
      // reach for `--no-verify`, which drops every other hook with it. Warn and
      // let the commit through. Nothing owns the snapshot yet, so tear it down.
      if (stagedProjectRuns.length === 0) {
        snapshot.cleanup();
        reportNothingToScan({
          reason: `Could not read any of the ${stagedFileCount} staged file${stagedFileCount === 1 ? "" : "s"} out of the index, so nothing was scanned. An unusually large staged file is the usual cause.`,
          severity: "warn",
        });
        return;
      }
      if (snapshot.unmaterializedFiles.length > 0 && !isQuiet) {
        // "not snapshotted", not "unreadable": the set also holds paths the
        // snapshot refused because they resolved outside the temp tree.
        const stagedFileLabel = `staged file${stagedFileCount === 1 ? "" : "s"}`;
        logger.warn(
          `Skipped ${snapshot.unmaterializedFiles.length} of ${stagedFileCount} ${stagedFileLabel}; they could not be snapshotted from the index.`,
        );
        logger.break();
      }

      const scanStagedProject = async (
        projectRun: (typeof stagedProjectRuns)[number],
      ): Promise<CompletedScan | null> => {
        const { projectScan, includePaths } = projectRun;
        if (
          scanDeadlineEpochMs !== undefined &&
          remainingDeadlineBudgetMs(scanDeadlineEpochMs) === 0
        ) {
          skippedProjects.push({ directory: projectScan.scanDirectory, reason: "max-duration" });
          return null;
        }
        const projectTempDirectory = path.join(
          snapshot.tempDirectory,
          projectScan.treeRelativeDirectory,
        );
        const scanResult = await inspectProject(projectTempDirectory, {
          ...scanOptions,
          deadlineEpochMs: scanDeadlineEpochMs,
          includePaths: [...includePaths],
          configOverride: projectScan.projectConfig,
          // Resolve `config.plugins` from the real config directory — the
          // staged temp snapshot has no node_modules or plugin files, so
          // anchoring resolution there silently drops every custom plugin
          // from pre-commit scans.
          configSourceDirectory: projectScan.projectConfigSourceDirectory ?? undefined,
          changedLineRanges:
            stagedLineRanges === null
              ? undefined
              : resolveProjectChangedLineRanges(
                  resolvedDirectory,
                  projectScan.scanDirectory,
                  stagedLineRanges,
                ),
          suppressRendering: isMultiProject,
          concurrentScan: isMultiProject,
        });

        const remappedDiagnostics = scanResult.diagnostics.map((diagnostic) => ({
          ...diagnostic,
          filePath: path.isAbsolute(diagnostic.filePath)
            ? diagnostic.filePath.replaceAll(projectTempDirectory, () => projectScan.scanDirectory)
            : diagnostic.filePath,
        }));
        return {
          directory: projectScan.scanDirectory,
          result: {
            ...scanResult,
            diagnostics: remappedDiagnostics,
            project: { ...scanResult.project, rootDirectory: projectScan.scanDirectory },
          },
          config: projectScan.projectConfig,
        };
      };

      const stagedBatch = await runProjectScanBatch({
        projects: stagedProjectRuns,
        isQuiet,
        isSilent: scanOptions.silent === true,
        scanProject: scanStagedProject,
      }).catch((error: unknown) => {
        snapshot.cleanup();
        throw error;
      });
      const completedScans = stagedBatch.completedScans;
      snapshot.cleanup();

      reportSkippedProjects({ skippedProjects, isQuiet });
      if (!isQuiet && isMultiProject && completedScans.length > 0) {
        await Effect.runPromise(
          printCompletedScansHeadless({
            categoryFilters,
            completedScans,
            elapsedMilliseconds: stagedBatch.elapsedMilliseconds,
            noScoreMessage: "Score unavailable.",
            outputDirectory: flags.outputDir,
            outputSurface: scanOptions.outputSurface ?? "cli",
            projectName: path.basename(resolvedDirectory),
            verbose: Boolean(flags.verbose),
          }),
        );
      }

      // Single-project scans dump from `inspect()`, and non-quiet workspace
      // scans from the aggregate headless report. Quiet workspace scans have
      // neither, so write their requested dump here.
      if (flags.outputDir && isMultiProject && isQuiet) {
        await Effect.runPromise(
          printDiagnosticsDump(
            filterDiagnosticsByCategories(
              filterScansForSurface(completedScans, scanOptions.outputSurface ?? "cli"),
              categoryFilters,
            ),
            flags.outputDir,
            false,
            "stderr",
          ),
        );
      }

      finalizeScans({
        completedScans,
        skippedProjects,
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
    const skippedProjects: JsonReportSkippedProject[] = [];

    const scanProject = async (projectScan: ResolvedProjectScan): Promise<CompletedScan | null> => {
      if (
        scanDeadlineEpochMs !== undefined &&
        remainingDeadlineBudgetMs(scanDeadlineEpochMs) === 0
      ) {
        skippedProjects.push({ directory: projectScan.directory, reason: "max-duration" });
        return null;
      }
      const scanDirectory = projectScan.directory;
      const projectConfig = projectScan.config;
      const ownsWorkspaceDeadCode = scanDirectory === workspaceDeadCodeOwner;
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
      const scanResult = await inspectProject(scanDirectory, {
        ...scanOptions,
        deadCode: workspaceDeadCodeOwner === null ? scanOptions.deadCode : ownsWorkspaceDeadCode,
        precomputedSourceFileCount: precomputedSourceFileCounts?.get(scanDirectory),
        deadlineEpochMs: scanDeadlineEpochMs,
        includePaths,
        configOverride: projectConfig,
        configSourceDirectory: projectScan.configSourceDirectory ?? undefined,
        suppressRendering: isMultiProject,
        // Pool members overlap; they must not own the process-global Sentry
        // run state (see `InspectOptions.concurrentScan`).
        concurrentScan: isMultiProject,
        excludedProjectDirectories: projectScans
          .filter((candidateProjectScan) =>
            isPathInsideDirectory(candidateProjectScan.directory, scanDirectory),
          )
          .map((candidateProjectScan) => candidateProjectScan.directory),
        retainExcludedProjectDeadCodeDiagnostics: ownsWorkspaceDeadCode,
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

    const projectBatch = await runProjectScanBatch({
      projects: projectScans,
      isQuiet,
      isSilent: scanOptions.silent === true,
      scanProject,
    });
    const completedScans = await retryMissingProjectScores(
      projectBatch.completedScans.map((completedScan) => ({
        ...completedScan,
        isScoreDisabled: scanOptions.noScore ?? completedScan.config?.noScore ?? false,
      })),
    );
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

    finalizeScans({
      completedScans,
      skippedProjects,
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
