import * as fs from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { performance } from "node:perf_hooks";
import * as Effect from "effect/Effect";
import {
  buildJsonReport,
  getChangedLineRanges,
  highlighter,
  type JsonReportSkippedProject,
  remainingDeadlineBudgetMs,
  type ResolvedScanTarget,
  toRelativePath,
} from "@react-doctor/core";
import type { createInvocationInspect } from "../../inspect.js";
import { CliInputError } from "./cli-input-error.js";
import { cliLogger as logger } from "./cli-logger.js";
import { METRIC, STAGED_FILES_TEMP_DIR_PREFIX } from "./constants.js";
import { filterDiagnosticsByCategories } from "./filter-diagnostics-by-categories.js";
import {
  type CompletedScan,
  finalizeCliScans,
  reportSkippedProjects,
} from "./finalize-cli-scans.js";
import { getStagedSourceFiles, materializeStagedFiles } from "./get-staged-files.js";
import type { InspectFlags } from "./inspect-flags.js";
import { writeJsonReport } from "./json-mode.js";
import { printCompletedScansHeadless } from "./print-completed-scans-headless.js";
import { printDiagnosticsDump } from "./print-diagnostics-dump.js";
import { recordCount } from "./record-metric.js";
import type { CliInspectOptions } from "./resolve-cli-inspect-options.js";
import { resolveProjectChangedLineRanges } from "./resolve-project-diff-include-paths.js";
import { resolveProjectRelativeDirectory } from "./resolve-project-relative-directory.js";
import { resolveProjectScan } from "./resolve-project-scan.js";
import { resolveProjectSourceFilePaths } from "./resolve-project-source-file-paths.js";
import { resolveScope } from "./resolve-scope.js";
import { runProjectScanBatch } from "./run-project-scan-batch.js";
import { filterScansForSurface } from "./filter-scans-for-surface.js";
import { STAGED_PROJECT_FALLBACK_HINT, selectStagedProjects } from "./select-staged-projects.js";
import { VERSION } from "./version.js";

interface RunStagedInspectInput {
  readonly flags: InspectFlags;
  readonly scanTarget: ResolvedScanTarget;
  readonly scanOptions: CliInspectOptions;
  readonly inspectProject: ReturnType<typeof createInvocationInspect>;
  readonly scanDeadlineEpochMs: number | undefined;
  readonly categoryFilters: ReadonlySet<string>;
  readonly isQuiet: boolean;
  readonly isJsonMode: boolean;
  readonly isScoreOnly: boolean;
  readonly startTime: number;
}

interface StagedProjectScanContext {
  readonly projectDirectory: string;
  readonly scanDirectory: string;
  readonly treeRelativeDirectory: string;
  readonly projectConfig: ResolvedScanTarget["userConfig"];
  readonly projectConfigSourceDirectory: string | null;
}

interface StagedProjectScan extends StagedProjectScanContext {
  readonly stagedFiles: ReadonlyArray<string>;
}

interface EmptyStagedScanInput {
  readonly directory: string;
  readonly isJsonMode: boolean;
  readonly isScoreOnly: boolean;
  readonly startTime: number;
}

const reportEmptyStagedScan = (
  input: EmptyStagedScanInput,
  reason: string,
  severity: "dim" | "warn" = "dim",
): void => {
  if (input.isJsonMode) {
    writeJsonReport(
      buildJsonReport({
        version: VERSION,
        directory: input.directory,
        mode: "staged",
        diff: null,
        scans: [],
        totalElapsedMilliseconds: performance.now() - input.startTime,
      }),
    );
    return;
  }
  if (input.isScoreOnly) return;
  if (severity === "warn") {
    logger.warn(reason);
    logger.break();
    return;
  }
  logger.dim(reason);
};

const resolveStagedProjectScanContexts = async (
  input: RunStagedInspectInput,
): Promise<StagedProjectScanContext[]> => {
  const { flags, scanTarget } = input;
  const rootDirectory = scanTarget.resolvedDirectory;
  const userConfig = scanTarget.userConfig;
  const hasConfigProjects = (userConfig?.projects ?? []).some(
    (projectName) => projectName.trim().length > 0,
  );
  const configProjectsApply =
    hasConfigProjects && scanTarget.requestedDirectory === scanTarget.configSourceDirectory;
  const projectDirectories = await selectStagedProjects({
    rootDirectory,
    projectFlag: flags.project,
    configProjects: configProjectsApply ? userConfig?.projects : undefined,
  });
  const projectScanContexts: StagedProjectScanContext[] = [];
  const seenScanDirectories = new Set<string>();

  for (const projectDirectory of projectDirectories) {
    const projectScan = await resolveProjectScan(scanTarget, projectDirectory);
    const treeRelativeDirectory = resolveProjectRelativeDirectory(
      rootDirectory,
      projectScan.directory,
    );
    if (treeRelativeDirectory === null) {
      if (flags.project) {
        throw new CliInputError(
          `Project "${toRelativePath(projectDirectory, rootDirectory)}" is outside ${rootDirectory}, so it holds none of the staged files. Run --staged from a directory that contains the project.`,
        );
      }
      continue;
    }
    if (seenScanDirectories.has(projectScan.directory)) continue;
    seenScanDirectories.add(projectScan.directory);
    projectScanContexts.push({
      projectDirectory,
      scanDirectory: projectScan.directory,
      treeRelativeDirectory,
      projectConfig: projectScan.config,
      projectConfigSourceDirectory: projectScan.configSourceDirectory,
    });
  }

  if (projectScanContexts.length > 0) return projectScanContexts;

  logger.warn(`No configured project is inside ${rootDirectory}. ${STAGED_PROJECT_FALLBACK_HINT}`);
  logger.break();
  const rootProjectScan = await resolveProjectScan(scanTarget, rootDirectory);
  const treeRelativeDirectory = resolveProjectRelativeDirectory(
    rootDirectory,
    rootProjectScan.directory,
  );
  return treeRelativeDirectory === null
    ? []
    : [
        {
          projectDirectory: rootDirectory,
          scanDirectory: rootProjectScan.directory,
          treeRelativeDirectory,
          projectConfig: rootProjectScan.config,
          projectConfigSourceDirectory: rootProjectScan.configSourceDirectory,
        },
      ];
};

const assignStagedFilesToProjects = (
  projectScanContexts: ReadonlyArray<StagedProjectScanContext>,
  stagedFiles: ReadonlyArray<string>,
): StagedProjectScan[] => {
  const contextsByLongestPathFirst = [...projectScanContexts].sort(
    (left, right) => right.treeRelativeDirectory.length - left.treeRelativeDirectory.length,
  );
  const ownedStagedFiles = new Map<string, string[]>();

  for (const stagedFile of stagedFiles) {
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

  return projectScanContexts.flatMap((projectScanContext) => {
    const projectStagedFiles = ownedStagedFiles.get(projectScanContext.scanDirectory);
    return projectStagedFiles === undefined
      ? []
      : [{ ...projectScanContext, stagedFiles: projectStagedFiles }];
  });
};

const collectConfigSubdirectories = (
  rootDirectory: string,
  projectScans: ReadonlyArray<StagedProjectScan>,
): string[] => {
  const configSubdirectories = new Set<string>();
  for (const projectScan of projectScans) {
    configSubdirectories.add(projectScan.treeRelativeDirectory);
    const projectRelativeDirectory = resolveProjectRelativeDirectory(
      rootDirectory,
      projectScan.projectDirectory,
    );
    if (projectRelativeDirectory !== null) configSubdirectories.add(projectRelativeDirectory);
  }
  return [...configSubdirectories];
};

export const runStagedInspect = async (input: RunStagedInspectInput): Promise<void> => {
  const { flags, scanTarget, scanOptions } = input;
  const resolvedDirectory = scanTarget.resolvedDirectory;
  const emptyScanInput: EmptyStagedScanInput = {
    directory: resolvedDirectory,
    isJsonMode: input.isJsonMode,
    isScoreOnly: input.isScoreOnly,
    startTime: input.startTime,
  };
  const projectScanContexts = await resolveStagedProjectScanContexts(input);
  const rootStagedFiles = await getStagedSourceFiles(resolvedDirectory);
  if (rootStagedFiles.length === 0) {
    reportEmptyStagedScan(emptyScanInput, "No staged source files found.");
    return;
  }

  const stagedProjectScans = assignStagedFilesToProjects(projectScanContexts, rootStagedFiles);
  if (stagedProjectScans.length === 0) {
    reportEmptyStagedScan(emptyScanInput, "No staged source files in the selected projects.");
    return;
  }

  const selectedStagedFiles = stagedProjectScans.flatMap((projectScan) => projectScan.stagedFiles);
  const stagedFileCount = selectedStagedFiles.length;
  const unselectedStagedFileCount = rootStagedFiles.length - stagedFileCount;
  if (!input.isQuiet) {
    logger.log(`Scanning ${highlighter.info(`${stagedFileCount}`)} staged files...`);
    if (unselectedStagedFileCount > 0) {
      logger.dim(
        `${unselectedStagedFileCount} more staged file${unselectedStagedFileCount === 1 ? "" : "s"} outside the selected projects.`,
      );
    }
    logger.break();
  }

  const stagedWantsLines = resolveScope(flags, scanTarget.userConfig).scope === "lines";
  const stagedLineRanges = stagedWantsLines
    ? await getChangedLineRanges({
        directory: resolvedDirectory,
        cached: true,
        files: selectedStagedFiles,
      })
    : null;
  if (stagedWantsLines && stagedLineRanges === null && !input.isQuiet) {
    logger.warn("Could not determine staged changed lines; reporting all issues in staged files.");
    logger.break();
  }
  if (stagedProjectScans.some((projectScan) => projectScan.treeRelativeDirectory.length > 0)) {
    recordCount(METRIC.stagedPerProject, 1, { projectCount: stagedProjectScans.length });
  }

  const tempDirectory = fs.mkdtempSync(path.join(tmpdir(), STAGED_FILES_TEMP_DIR_PREFIX));
  const snapshot = await materializeStagedFiles({
    directory: resolvedDirectory,
    stagedFiles: selectedStagedFiles,
    tempDirectory,
    configSubdirectories: collectConfigSubdirectories(resolvedDirectory, stagedProjectScans),
  }).catch((error: unknown) => {
    fs.rmSync(tempDirectory, { recursive: true, force: true });
    throw error;
  });

  try {
    const materializedStagedFiles = new Set(snapshot.stagedFiles);
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
    const isMultiProject = stagedProjectRuns.length > 1;
    const skippedProjects: JsonReportSkippedProject[] = [];

    if (stagedProjectRuns.length === 0) {
      reportEmptyStagedScan(
        emptyScanInput,
        `Could not read any of the ${stagedFileCount} staged file${stagedFileCount === 1 ? "" : "s"} out of the index, so nothing was scanned. An unusually large staged file is the usual cause.`,
        "warn",
      );
      return;
    }
    if (snapshot.unmaterializedFiles.length > 0 && !input.isQuiet) {
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
        input.scanDeadlineEpochMs !== undefined &&
        remainingDeadlineBudgetMs(input.scanDeadlineEpochMs) === 0
      ) {
        skippedProjects.push({ directory: projectScan.scanDirectory, reason: "max-duration" });
        return null;
      }
      const projectTempDirectory = path.join(
        snapshot.tempDirectory,
        projectScan.treeRelativeDirectory,
      );
      const scanResult = await input.inspectProject(projectTempDirectory, {
        ...scanOptions,
        deadlineEpochMs: input.scanDeadlineEpochMs,
        includePaths: [...includePaths],
        configOverride: projectScan.projectConfig,
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
      const diagnostics = scanResult.diagnostics.map((diagnostic) => ({
        ...diagnostic,
        filePath: path.isAbsolute(diagnostic.filePath)
          ? diagnostic.filePath.replaceAll(projectTempDirectory, () => projectScan.scanDirectory)
          : diagnostic.filePath,
      }));
      return {
        directory: projectScan.scanDirectory,
        result: {
          ...scanResult,
          diagnostics,
          project: { ...scanResult.project, rootDirectory: projectScan.scanDirectory },
        },
        config: projectScan.projectConfig,
      };
    };

    const stagedBatch = await runProjectScanBatch({
      projects: stagedProjectRuns,
      isQuiet: input.isQuiet,
      isSilent: scanOptions.silent === true,
      scanProject: scanStagedProject,
    });
    const completedScans = stagedBatch.completedScans;
    reportSkippedProjects({ skippedProjects, isQuiet: input.isQuiet });

    if (!input.isQuiet && isMultiProject && completedScans.length > 0) {
      await Effect.runPromise(
        printCompletedScansHeadless({
          categoryFilters: input.categoryFilters,
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
    if (flags.outputDir && isMultiProject && input.isQuiet) {
      await Effect.runPromise(
        printDiagnosticsDump(
          filterDiagnosticsByCategories(
            filterScansForSurface(completedScans, scanOptions.outputSurface ?? "cli"),
            input.categoryFilters,
          ),
          flags.outputDir,
          false,
          "stderr",
        ),
      );
    }

    finalizeCliScans({
      completedScans,
      skippedProjects,
      mode: "staged",
      diff: null,
      baselineIntended: false,
      isJsonMode: input.isJsonMode,
      isScoreOnly: input.isScoreOnly,
      flags,
      categoryFilters: input.categoryFilters,
      userConfig: scanTarget.userConfig,
      resolvedDirectory,
      startTime: input.startTime,
    });
  } finally {
    snapshot.cleanup();
  }
};
