import { tmpdir } from "node:os";
import * as path from "node:path";
import * as fs from "node:fs";
import {
  DEFAULT_PROJECT_SCAN_CONCURRENCY,
  getChangedLineRanges,
  getDiffInfo,
  highlighter,
  mapWithConcurrency,
  mergeReactDoctorConfigs,
  resolveScanTarget,
  toRelativePath,
} from "@react-doctor/core";
import type { Diagnostic, DiffInfo, InspectResult, ReactDoctorConfig } from "@react-doctor/core";
import { inspect } from "../../inspect.js";
import { cliLogger as logger } from "../utils/cli-logger.js";
import { METRIC, STAGED_FILES_TEMP_DIR_PREFIX } from "../utils/constants.js";
import { ensureReactDoctorGitignore } from "../utils/ensure-react-doctor-gitignore.js";
import { filterDiagnosticsByCategories } from "../utils/filter-diagnostics-by-categories.js";
import { filterScansForSurface } from "../utils/filter-scans-for-surface.js";
import { getStagedSourceFiles, materializeStagedFiles } from "../utils/get-staged-files.js";
import { handleError, handleUserError } from "../utils/handle-error.js";
import { isCiOrCodingAgentEnvironment } from "../utils/is-ci-environment.js";
import { isExpectedUserError } from "../utils/is-expected-user-error.js";
import type { InspectFlags } from "../utils/inspect-flags.js";
import { resolveMergeBaseRef } from "../utils/materialize-baseline-files.js";
import { projectManifestChanged } from "../utils/project-manifest-changed.js";
import { readChangedFilesFrom } from "../utils/read-changed-files-from.js";
import { recordCount } from "../utils/record-metric.js";
import { buildRulePriorityMap } from "../utils/diagnostic-grouping.js";
import { reportErrorToSentry } from "../utils/report-error.js";
import { resolveCliInspectOptions } from "../utils/resolve-cli-inspect-options.js";
import type { CliInspectOptions } from "../utils/resolve-cli-inspect-options.js";
import {
  resolveProjectChangedLineRanges,
  resolveProjectDiffIncludePaths,
} from "../utils/resolve-project-diff-include-paths.js";
import type { RequestedScope } from "../utils/resolve-scope.js";
import { finalizeScope, resolveScope, warnDeprecatedDiff } from "../utils/resolve-scope.js";
import { selectProjects } from "../utils/select-projects.js";
import { shouldSkipPrompts } from "../utils/should-skip-prompts.js";
import { isSpinnerSilent, setSpinnerSilent, spinner } from "../utils/spinner.js";
import { runTriageLoop } from "../utils/run-triage-loop.js";
import { validateModeFlags } from "../utils/validate-mode-flags.js";
import { warnDeprecatedFailOn } from "../utils/warn-deprecated-fail-on.js";
import { writeDiagnosticsDirectory } from "../utils/write-diagnostics-directory.js";

interface CompletedScan {
  readonly directory: string;
  readonly result: InspectResult;
  readonly config: ReactDoctorConfig | null;
}

const buildChangedFilesDiffInfo = (changedFiles: string[]): DiffInfo => ({
  currentBranch: process.env.GITHUB_HEAD_REF?.trim() || null,
  baseBranch: process.env.GITHUB_BASE_REF?.trim() || "pull request target",
  baseSha: process.env.REACT_DOCTOR_BASE_SHA?.trim() || undefined,
  changedFiles,
  isCurrentChanges: false,
});

const defaultTriageOutputDirectory = (rootDirectory: string): string =>
  path.join(rootDirectory, ".react-doctor", "triage");

const normalizeDiagnosticPath = (
  rootDirectory: string,
  scanDirectory: string,
  diagnostic: Diagnostic,
): Diagnostic => {
  const absoluteFilePath = path.isAbsolute(diagnostic.filePath)
    ? diagnostic.filePath
    : path.join(scanDirectory, diagnostic.filePath);
  return { ...diagnostic, filePath: toRelativePath(absoluteFilePath, rootDirectory) };
};

const normalizeScanPaths = (rootDirectory: string, scan: CompletedScan): CompletedScan => ({
  ...scan,
  result: {
    ...scan.result,
    diagnostics: scan.result.diagnostics.map((diagnostic) =>
      normalizeDiagnosticPath(rootDirectory, scan.directory, diagnostic),
    ),
  },
});

const scanStagedFiles = async (
  resolvedDirectory: string,
  userConfig: ReactDoctorConfig | null,
  flags: InspectFlags,
  scanOptions: CliInspectOptions,
): Promise<CompletedScan[]> => {
  const stagedFiles = await getStagedSourceFiles(resolvedDirectory);
  if (stagedFiles.length === 0) {
    logger.dim("No staged source files found.");
    return [];
  }

  const scanSpinner = spinner(`Scanning ${stagedFiles.length} staged files...`).start();

  const tempDirectory = fs.mkdtempSync(path.join(tmpdir(), STAGED_FILES_TEMP_DIR_PREFIX));
  try {
    const snapshot = await materializeStagedFiles(
      resolvedDirectory,
      stagedFiles,
      tempDirectory,
    ).catch((error: unknown) => {
      fs.rmSync(tempDirectory, { recursive: true, force: true });
      throw error;
    });
    const stagedWantsLines = resolveScope(flags, userConfig).scope === "lines";
    const stagedLineRanges = stagedWantsLines
      ? await getChangedLineRanges({
          directory: resolvedDirectory,
          cached: true,
          files: snapshot.stagedFiles,
        })
      : null;
    if (stagedWantsLines && stagedLineRanges === null) {
      logger.warn(
        "Could not determine staged changed lines; reporting all issues in staged files.",
      );
      logger.break();
    }

    try {
      const scanResult = await inspect(snapshot.tempDirectory, {
        ...scanOptions,
        outputDirectory: undefined,
        includePaths: snapshot.stagedFiles,
        configOverride: userConfig,
        changedLineRanges: stagedLineRanges ?? undefined,
        suppressRendering: true,
      });
      const remappedDiagnostics = scanResult.diagnostics.map((diagnostic) => ({
        ...diagnostic,
        filePath: path.isAbsolute(diagnostic.filePath)
          ? diagnostic.filePath.replaceAll(snapshot.tempDirectory, () => resolvedDirectory)
          : diagnostic.filePath,
      }));
      return [
        {
          directory: resolvedDirectory,
          result: {
            ...scanResult,
            diagnostics: remappedDiagnostics,
            project: { ...scanResult.project, rootDirectory: resolvedDirectory },
          },
          config: userConfig,
        },
      ];
    } finally {
      snapshot.cleanup();
    }
  } finally {
    scanSpinner.stop();
  }
};

const scanProjects = async (
  rootDirectory: string,
  projectDirectories: readonly string[],
  rootConfig: ReactDoctorConfig | null,
  flags: InspectFlags,
  scanOptions: CliInspectOptions,
): Promise<CompletedScan[]> => {
  const changedFilesDiffInfo = flags.changedFilesFrom
    ? buildChangedFilesDiffInfo(readChangedFilesFrom(path.resolve(flags.changedFilesFrom)))
    : null;
  const requestedScope = resolveScope(flags, rootConfig);
  const scopeRequest: RequestedScope =
    requestedScope.scope === undefined && changedFilesDiffInfo !== null
      ? { ...requestedScope, scope: "changed" }
      : requestedScope;
  const wantsDiffMode = scopeRequest.scope !== undefined && scopeRequest.scope !== "full";
  const shouldDetectDiff = changedFilesDiffInfo === null && wantsDiffMode;
  const diffInfo =
    changedFilesDiffInfo ??
    (shouldDetectDiff ? await getDiffInfo(rootDirectory, scopeRequest.base) : null);
  const scope = await finalizeScope({
    requested: scopeRequest,
    diffInfo,
    skipPrompts: true,
    isQuiet: true,
  });
  const isDiffMode = scope !== "full";
  const comparisonBaseRef =
    isDiffMode && diffInfo && !diffInfo.isCurrentChanges
      ? diffInfo.baseSha
        ? await resolveMergeBaseRef(rootDirectory, diffInfo.baseSha)
        : (diffInfo.diffBaseRef ?? (await resolveMergeBaseRef(rootDirectory, diffInfo.baseBranch)))
      : null;
  const baselineRef = scope === "changed" ? comparisonBaseRef : null;
  const linesBaseRef = diffInfo?.isCurrentChanges ? "HEAD" : comparisonBaseRef;
  const canComputeLines =
    scope === "lines" && diffInfo !== null && (diffInfo.isCurrentChanges || linesBaseRef !== null);
  const changedLineRanges =
    canComputeLines && diffInfo !== null
      ? await getChangedLineRanges({
          directory: rootDirectory,
          baseRef: linesBaseRef ?? undefined,
          files: [...diffInfo.changedFiles],
        })
      : null;
  if (scope === "lines" && changedLineRanges === null) {
    logger.warn(
      "Could not determine changed lines (no base ref or git diff failed); reporting all issues in changed files.",
    );
    logger.break();
  }
  if (isDiffMode && diffInfo) {
    if (diffInfo.isCurrentChanges) {
      logger.log("Scanning uncommitted changes");
    } else {
      const currentBranchLabel = diffInfo.currentBranch ?? "(detached HEAD)";
      logger.log(
        `Scanning changes: ${highlighter.info(currentBranchLabel)} -> ${highlighter.info(diffInfo.baseBranch)}`,
      );
    }
    logger.break();
  }

  const rootScanTarget = await resolveScanTarget(rootDirectory, { allowAmbiguous: true });
  const isMultiProject = projectDirectories.length > 1;
  const batchSpinner = spinner(
    isMultiProject ? `Scanning ${projectDirectories.length} projects...` : "Scanning project...",
  ).start();
  const wasSpinnerSilent = isSpinnerSilent();
  setSpinnerSilent(true);
  let finishedProjectCount = 0;
  try {
    const scanOutcomes = await mapWithConcurrency(
      projectDirectories,
      isMultiProject ? DEFAULT_PROJECT_SCAN_CONCURRENCY : 1,
      async (projectDirectory): Promise<CompletedScan | null> => {
        const projectScanTarget =
          projectDirectory === rootDirectory
            ? rootScanTarget
            : await resolveScanTarget(projectDirectory, { allowAmbiguous: true });
        const scanDirectory = projectScanTarget.resolvedDirectory;
        const projectConfig =
          projectDirectory === rootDirectory
            ? rootConfig
            : mergeReactDoctorConfigs(rootConfig, projectScanTarget.userConfig ?? undefined);
        const projectConfigSourceDirectory =
          projectScanTarget.userConfig?.plugins === undefined
            ? rootScanTarget.configSourceDirectory
            : projectScanTarget.configSourceDirectory;
        const supplyChainEnabled = projectConfig?.supplyChain?.enabled !== false;
        let includePaths: string[] | undefined;
        let supplyChainManifestChanged = false;
        if (isDiffMode) {
          const changedSourceFiles =
            diffInfo === null
              ? []
              : resolveProjectDiffIncludePaths(rootDirectory, scanDirectory, diffInfo);
          supplyChainManifestChanged =
            supplyChainEnabled &&
            diffInfo !== null &&
            projectManifestChanged(rootDirectory, scanDirectory, diffInfo);
          if (changedSourceFiles.length === 0 && !supplyChainManifestChanged) {
            logger.dim(`No changed source files in ${scanDirectory}, skipping.`);
            logger.break();
            return null;
          }
          includePaths = [...changedSourceFiles];
          if (supplyChainManifestChanged) includePaths.push("package.json");
        }
        const scanResult = await inspect(scanDirectory, {
          ...scanOptions,
          outputDirectory: undefined,
          includePaths,
          configOverride: projectConfig,
          configSourceDirectory: projectConfigSourceDirectory ?? undefined,
          suppressRendering: true,
          concurrentScan: isMultiProject,
          baseline: baselineRef ? { ref: baselineRef } : undefined,
          changedLineRanges:
            scope === "lines" && changedLineRanges !== null
              ? resolveProjectChangedLineRanges(rootDirectory, scanDirectory, changedLineRanges)
              : undefined,
          supplyChainManifestChanged,
        });
        finishedProjectCount += 1;
        if (isMultiProject) {
          batchSpinner.update(
            `Scanning ${projectDirectories.length} projects... (${finishedProjectCount}/${projectDirectories.length})`,
          );
        }
        return { directory: scanDirectory, result: scanResult, config: projectConfig };
      },
    );
    return scanOutcomes.filter((scanOutcome): scanOutcome is CompletedScan => scanOutcome !== null);
  } finally {
    setSpinnerSilent(wasSpinnerSilent);
    batchSpinner.stop();
  }
};

export const triageAction = async (directory: string, flags: InspectFlags): Promise<void> => {
  recordCount(METRIC.cliInvoked, 1, { command: "triage" });
  if (
    shouldSkipPrompts({ yes: flags.yes, json: flags.json }) ||
    process.stdout.isTTY !== true ||
    isCiOrCodingAgentEnvironment()
  ) {
    logger.dim("React Doctor triage requires an interactive terminal.");
    return;
  }

  const requestedDirectory = path.resolve(directory);
  try {
    validateModeFlags({ ...flags, json: false });
    const scanTarget = await resolveScanTarget(requestedDirectory, { allowAmbiguous: true });
    const rootDirectory = scanTarget.resolvedDirectory;
    const userConfig = scanTarget.userConfig;
    warnDeprecatedFailOn(flags, userConfig);
    warnDeprecatedDiff(flags, userConfig);
    const outputDirectory = path.resolve(
      flags.outputDir ?? defaultTriageOutputDirectory(rootDirectory),
    );
    ensureReactDoctorGitignore(rootDirectory);

    const scanOptions: CliInspectOptions = {
      ...resolveCliInspectOptions({ ...flags, json: false, outputDir: undefined }, userConfig),
      silent: true,
      outputDirectory: undefined,
    };
    const completedScans = flags.staged
      ? await scanStagedFiles(rootDirectory, userConfig, flags, scanOptions)
      : await scanProjects(
          rootDirectory,
          await selectProjects(rootDirectory, flags.project, true, userConfig?.projects),
          userConfig,
          flags,
          scanOptions,
        );
    const normalizedScans = completedScans.map((scan) => normalizeScanPaths(rootDirectory, scan));
    const surfaceDiagnostics = filterScansForSurface(normalizedScans, "cli");
    const categoryFilters = new Set(scanOptions.categoryFilters ?? []);
    const diagnostics = filterDiagnosticsByCategories(surfaceDiagnostics, categoryFilters);
    writeDiagnosticsDirectory(diagnostics, outputDirectory);

    if (diagnostics.length === 0) {
      logger.log(highlighter.success("No React Doctor diagnostics to triage."));
      return;
    }

    const rulePriority = buildRulePriorityMap(normalizedScans.map((scan) => scan.result.score));
    const result = await runTriageLoop({
      diagnostics,
      outputDirectory,
      projectName: path.basename(rootDirectory),
      rootDirectory,
      rulePriority,
    });
    recordCount(METRIC.triage, 1, {
      totalRules: result.totalRules,
      rulesPrompted: result.rulesPrompted,
      rulesSkipped: result.rulesSkipped,
      rulesDisabled: result.rulesDisabled,
      rulesRemaining: result.rulesRemaining,
    });
    logger.break();
    logger.log(
      `Triage session complete. ${highlighter.info(`${result.rulesRemaining}`)} rules remaining.`,
    );
  } catch (error) {
    const isUserError = isExpectedUserError(error);
    const sentryEventId = isUserError ? undefined : await reportErrorToSentry(error);
    if (isUserError) {
      handleUserError(error);
      return;
    }
    handleError(error, { sentryEventId });
  }
};
