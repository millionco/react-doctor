import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import * as Effect from "effect/Effect";
import {
  buildJsonReport,
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
import { STAGED_FILES_TEMP_DIR_PREFIX } from "../utils/constants.js";
import { getStagedSourceFiles, materializeStagedFiles } from "../utils/get-staged-files.js";
import type { InspectFlags } from "../utils/inspect-flags.js";
import { handleError } from "../utils/handle-error.js";
import { handoffToAgent } from "../utils/handoff-to-agent.js";
import { migrateLegacyConfig } from "../utils/migrate-legacy-config.js";
import {
  enableJsonMode,
  setJsonReportDirectory,
  setJsonReportMode,
  writeJsonErrorReport,
  writeJsonReport,
} from "../utils/json-mode.js";
import { printAnnotations } from "../utils/print-annotations.js";
import { printBrandedHeader } from "../utils/print-branded-header.js";
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
import { resolveDiffMode } from "../utils/resolve-diff-mode.js";
import { resolveEffectiveDiff } from "../utils/resolve-effective-diff.js";
import { resolveFailOnLevel } from "../utils/resolve-fail-on-level.js";
import { resolveProjectDiffIncludePaths } from "../utils/resolve-project-diff-include-paths.js";
import { runExplain } from "../utils/run-explain.js";
import { selectProjects } from "../utils/select-projects.js";
import { shouldFailForDiagnostics } from "../utils/should-fail-for-diagnostics.js";
import { shouldSkipPrompts } from "../utils/should-skip-prompts.js";
import { validateModeFlags } from "../utils/validate-mode-flags.js";
import { VERSION } from "../utils/version.js";

interface CompletedScan {
  directory: string;
  result: InspectResult;
}

interface FinalizeScansInput {
  readonly diagnostics: Diagnostic[];
  readonly completedScans: CompletedScan[];
  readonly mode: JsonReportMode;
  readonly diff: DiffInfo | null;
  readonly isJsonMode: boolean;
  readonly isScoreOnly: boolean;
  readonly flags: InspectFlags;
  readonly userConfig: ReactDoctorConfig | null;
  readonly resolvedDirectory: string;
  readonly startTime: number;
}

/**
 * Post-scan finalization shared by the staged-arm and project-loop
 * paths of `inspectAction`: emit the JSON report (when in JSON mode),
 * print PR annotations (when `--annotations`), and set
 * `process.exitCode = 1` when the configured fail-on threshold is
 * crossed. Both arms previously inlined the same four-step shape.
 */
const finalizeScans = (input: FinalizeScansInput): void => {
  if (input.isJsonMode) {
    writeJsonReport(
      buildJsonReport({
        version: VERSION,
        directory: input.resolvedDirectory,
        mode: input.mode,
        diff: input.diff,
        scans: input.completedScans,
        totalElapsedMilliseconds: performance.now() - input.startTime,
      }),
    );
  }

  if (input.flags.annotations) {
    printAnnotations(input.diagnostics, input.isJsonMode);
  }

  const ciFailureDiagnostics = filterDiagnosticsForSurface(
    input.diagnostics,
    "ciFailure",
    input.userConfig,
  );
  if (
    !input.isScoreOnly &&
    shouldFailForDiagnostics(
      ciFailureDiagnostics,
      resolveFailOnLevel(input.flags, input.userConfig),
    )
  ) {
    process.exitCode = 1;
  }
};

const buildChangedFilesDiffInfo = (changedFiles: string[]): DiffInfo => ({
  currentBranch: process.env.GITHUB_HEAD_REF?.trim() || null,
  baseBranch: process.env.GITHUB_BASE_REF?.trim() || "pull request target",
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
 * are left untouched — the loader's warning still nudges them — so a scan
 * never mutates the repo unattended.
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

  try {
    validateModeFlags(flags);

    maybeMigrateLegacyConfig(requestedDirectory, { isQuiet, isStaged: Boolean(flags.staged) });

    const scanTarget = await resolveScanTarget(requestedDirectory, { allowAmbiguous: true });
    const userConfig = scanTarget.userConfig;
    const resolvedDirectory = scanTarget.resolvedDirectory;
    setJsonReportDirectory(resolvedDirectory);
    if (scanTarget.didRedirectViaRootDir && !isQuiet) {
      logger.dim(
        `Redirected to ${highlighter.info(toRelativePath(resolvedDirectory, requestedDirectory))} via react-doctor config "rootDir".`,
      );
      logger.break();
    }

    const explainArgument = flags.explain ?? flags.why;
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
      Effect.runSync(printBrandedHeader);
    }

    const scanOptions = resolveCliInspectOptions(flags, userConfig);
    const skipPrompts = shouldSkipPrompts({ yes: flags.yes, full: flags.full, json: flags.json });

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

      const tempDirectory = mkdtempSync(path.join(tmpdir(), STAGED_FILES_TEMP_DIR_PREFIX));
      // If materialization throws before `snapshot.cleanup` is wired up,
      // remove the temp dir we just created so it can't leak.
      const snapshot = await materializeStagedFiles(
        resolvedDirectory,
        stagedFiles,
        tempDirectory,
      ).catch((error: unknown) => {
        rmSync(tempDirectory, { recursive: true, force: true });
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
          isJsonMode,
          isScoreOnly,
          flags,
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

    const changedFilesDiffInfo =
      flags.changedFilesFrom && !flags.full
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

    // HACK: set the report-mode marker BEFORE the scan loop runs — if the
    // user hits Ctrl-C mid-scan, the SIGINT handler reads it for the JSON
    // cancel report. Setting it after the loop completes means a cancelled
    // diff scan would report mode: "full".
    setJsonReportMode(isDiffMode ? "diff" : "full");

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

    for (const projectDirectory of projectDirectories) {
      let includePaths: string[] | undefined;
      if (isDiffMode) {
        const changedSourceFiles =
          diffInfo === null
            ? []
            : resolveProjectDiffIncludePaths(resolvedDirectory, projectDirectory, diffInfo);
        if (changedSourceFiles.length === 0) {
          if (!isQuiet) {
            logger.dim(`No changed source files in ${projectDirectory}, skipping.`);
            logger.break();
          }
          continue;
        }
        includePaths = changedSourceFiles;
      }

      if (!isQuiet && !isMultiProject) {
        logger.dim("  ");
      }
      const scanResult = await inspect(projectDirectory, {
        ...scanOptions,
        includePaths,
        configOverride: userConfig,
        suppressRendering: isMultiProject,
      });
      allDiagnostics.push(...scanResult.diagnostics);
      completedScans.push({ directory: projectDirectory, result: scanResult });
      if (!isQuiet && !isMultiProject) {
        logger.break();
      }
    }

    if (!isQuiet && isMultiProject && completedScans.length > 0) {
      await Effect.runPromise(
        printMultiProjectSummary({
          completedScans,
          userConfig,
          verbose: Boolean(flags.verbose),
        }),
      );
    }

    finalizeScans({
      diagnostics: allDiagnostics,
      completedScans,
      mode: isDiffMode ? "diff" : "full",
      diff: isDiffMode ? diffInfo : null,
      isJsonMode,
      isScoreOnly,
      flags,
      userConfig,
      resolvedDirectory,
      startTime,
    });

    const surfaceDiagnostics = filterDiagnosticsForSurface(
      allDiagnostics,
      scanOptions.outputSurface ?? "cli",
      userConfig,
    );

    // After the results print, offer to hand the issues to a coding agent
    // — an interactive select (no flag). Skipped for quiet, skip-prompts,
    // non-TTY, and agent/CI runs (those get the install hint below).
    const canPromptInteractively =
      !isQuiet && !skipPrompts && process.stdout.isTTY === true && !isCiOrCodingAgentEnvironment();
    if (canPromptInteractively && surfaceDiagnostics.length > 0) {
      await handoffToAgent({
        diagnostics: surfaceDiagnostics,
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
      }
    }
  } catch (error) {
    const sentryEventId = await reportErrorToSentry(error);
    if (isJsonMode) {
      writeJsonErrorReport(error);
      process.exitCode = 1;
      return;
    }
    handleError(error, { sentryEventId });
  }
};
